import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { fetchPlutoHowItWorks, type PlutoHowItWorks } from "../../api/pluto";
import { formatCurrency, formatCurrencyTrimmed, formatDelta, formatPercentageValueTrimmed } from "../../lib/formatters";
import { plutoStrategyLabels } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";

// Pluto's "How it works" tab (approved mockups https://claude.ai/artifact/TYdARe8Sa6RuF5Lb1E1s2b and, for Vol Farmer v2,
// https://claude.ai/artifact/QGwKxNa7orZFFjfeRBnhoU): a plain-language explanation of each strategy for readers who do not
// read code. Every number comes from GET /pluto/how-it-works (Pluto's live settings and the code's own constants); only
// the wording lives here, so a change to a rule the text describes must update this file too (API CLAUDE.md).

const pct = (percent: number) => formatPercentageValueTrimmed(percent, 2);

function Value({ children }: { children: ReactNode }) {
  return <span className="pm-how-v">{children}</span>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pm-card">
      <div className="pm-card-h">
        <h2 className="pm-card-t">{title}</h2>
      </div>
      <div className="pm-card-b pm-how-body">{children}</div>
    </section>
  );
}

function Step({ number, tone, title, children }: { number: number; tone: "call" | "put"; title: string; children: ReactNode }) {
  return (
    <div className="pm-how-step">
      <h3 className="pm-how-step-h">
        <span className={`pm-how-step-n ${tone}`}>{number}</span>
        {title}
      </h3>
      <p className="pm-how-text">{children}</p>
    </div>
  );
}

function Figure({ tone, label, value, detail }: { tone: "plain" | "call" | "put"; label: string; value: string; detail: ReactNode }) {
  return (
    <div className={`pm-how-figure ${tone}`}>
      <div className="pm-how-figure-l">{label}</div>
      <div className="pm-how-figure-v">{value}</div>
      <div className="pm-how-figure-s">{detail}</div>
    </div>
  );
}

function RuleTable({ heading, rows }: { heading: string; rows: { name: string; value: string; meaning: string }[] }) {
  return (
    <div className="pm-table-wrap pm-how-table-wrap">
      <table className="pm-table pm-how-table">
        <thead>
          <tr>
            <th scope="col">{heading}</th>
            <th scope="col">Value</th>
            <th scope="col">In plain words</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="medium">{row.name}</td>
              <td className="nw"><Value>{row.value}</Value></td>
              <td className="pm-how-meaning">{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ label, value, widthPct, tone }: { label: string; value: number; widthPct: number; tone: "call" | "put" }) {
  return (
    <div className="pm-how-bar">
      <div className="pm-how-bar-l">{label}</div>
      <div className="pm-how-bar-track" aria-hidden="true">
        <div className={`pm-how-bar-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, widthPct))}%` }} />
      </div>
      <div className="pm-how-bar-v">{formatCurrency(value)}</div>
    </div>
  );
}

function LadderExplanation({ values }: { values: PlutoHowItWorks }) {
  const { ladder, shared } = values;
  const { example } = ladder;
  const deltaRange = `${formatDelta(ladder.minAbsDelta)}–${formatDelta(ladder.maxAbsDelta)}`;
  const firstRung = example.rungs[0];
  const putOverCall = ladder.putOverCallYieldMarginPct > 0 ? `whenever the Put's yield is more than ${pct(ladder.putOverCallYieldMarginPct)} above the Call's` : "whenever the Put pays a higher yield";
  const contractRules = [
    { name: "Delta of Calls", value: deltaRange, meaning: `Roughly a ${pct(ladder.minAbsDelta * 100)} to ${pct(ladder.maxAbsDelta * 100)} chance of ending in the money. Further out is safer but pays less.` },
    { name: "Delta of a Put that opens a cycle", value: deltaRange, meaning: "The same range as the Calls." },
    { name: "Delta of ladder Puts", value: "any", meaning: "No delta limit: a ladder Put's strike must be at or below its rung's cap, which already keeps it well below the price." },
    { name: "Yield to open a cycle", value: `> ${pct(ladder.minEntryYieldPct)} a year`, meaning: `The Put or Covered Call that opens a cycle must pay more than ${pct(ladder.minEntryYieldPct)} a year on the money it ties up. Calls on shares already held and ladder Puts have no minimum.` },
    { name: "Fresh price", value: `≤ ${ladder.maxQuoteAgeMinutes} min`, meaning: `Prices older than ${ladder.maxQuoteAgeMinutes} minutes are not used; if all of a ticker's latest prices are older, nothing is planned on it until fresh ones come in.` },
    { name: "Days to expiry", value: `${ladder.minDte}–${ladder.maxDte}`, meaning: `Contracts expiring ${ladder.minDte} to ${ladder.maxDte} days from today.` },
    { name: "Spread", value: `≤ ${pct(ladder.maxSpreadPctOfMid)} of the mid`, meaning: `The gap between bid and ask must be at most ${pct(ladder.maxSpreadPctOfMid)} of the middle price, so the price is fair.` },
    { name: "Bid", value: `≥ ${formatCurrencyTrimmed(ladder.minimumBid)}`, meaning: `Contracts bid below ${formatCurrencyTrimmed(ladder.minimumBid)} are skipped.` },
    { name: "Size", value: `≤ ${pct(ladder.maxVolumeSharePct)} of volume`, meaning: `At most ${pct(ladder.maxVolumeSharePct)} of the contracts that traded in the previous session.` },
    { name: "Calls on held shares", value: "≥ break-even", meaning: "Only strikes at or above the break-even, so a call-away never sells at a loss. The Covered Call that opens a cycle may use any strike." },
  ];

  return (
    <>
      <Card title="The CC + Put Ladder">
        <p className="pm-how-lead">
          Pluto owns shares of each enabled ticker and earns income by selling options on them. It sells <b>Calls</b> on the shares it holds, and <b>Puts</b> that may buy more shares at lower prices if the stock falls. The Puts are spread out like the rungs of a ladder, each one lower than the last, so a fall buys shares cheaper and brings the cost of the position down.
        </p>
        <p className="pm-how-text muted">No AI model is involved: every decision follows the fixed rules below. The numbers in <Value>mono</Value> are Pluto's current settings.</p>
      </Card>

      <Card title="One cycle, step by step">
        <div className="pm-how-steps">
          <Step number={1} tone="call" title="Open: sell a Put, or buy shares and sell a Call">
            The cycle opens with whichever pays the higher premium yield: a <b>Put</b> that may buy the shares, or a <b>Covered Call</b>, where Pluto buys shares in lots of 100 and sells a Call on every lot in the same order. Either must pay more than <Value>{pct(ladder.minEntryYieldPct)}</Value> a year. Up to <Value>{pct(ladder.sharesPct)}</Value> of the ticker's pot goes into shares. When the opening Put is assigned, Pluto holds the shares and the ladder starts.
          </Step>
          <Step number={2} tone="call" title="Keep selling Calls, never at a loss">
            Each time a Call expires, Pluto sells a new one, with a strike at or above the <b>break-even</b>: what the shares cost, less every premium collected in the cycle. If the shares are called away, they are sold at a profit.
          </Step>
          <Step number={3} tone="put" title="Stock falls: sell Puts down the ladder">
            When the stock is too far below the break-even for any Call to qualify, Pluto sells Puts from the rest of the pot, the reserve, in <Value>{ladder.rungs}</Value> rungs. It also sells a Put instead of a Call {putOverCall}.
          </Step>
          <Step number={4} tone="put" title="A Put assigned lowers the cost">
            If a Put is assigned, Pluto buys more shares at the lower strike. The average cost and the break-even come down, so Calls qualify again sooner. When Calls take every share away, the cycle ends and a new one starts at step 1.
          </Step>
        </div>
      </Card>

      <Card title="How the money is split">
        <p className="pm-how-text muted">Each ticker gets a pot. Part of it buys shares, the rest is kept in cash for the Puts. The pot is set when the cycle starts and only grows: if the account falls during a cycle, the plan stays as it was.</p>
        <div className="pm-how-figures">
          <Figure tone="plain" label="Ticker's pot" value={formatCurrency(example.pot, 0)} detail={`allocation ${pct(example.allocationPct)} × capital budget ${pct(shared.capitalBudgetPct)} × account ${formatCurrency(example.accountValue, 0)}`} />
          <Figure tone="call" label="Shares (Covered Calls)" value={formatCurrency(example.sharesBudget, 0)} detail={`${pct(ladder.sharesPct)} of the pot`} />
          <Figure tone="put" label="Reserve (Put ladder)" value={formatCurrency(example.reserve, 0)} detail={`${ladder.rungs} rungs of ${formatCurrency(example.rungCollateral, 0)}`} />
        </div>
        <p className="pm-how-note">Example figures. The pot is the ticker's allocation × Pluto's capital budget × the larger of the account value when the cycle started and today's.</p>
      </Card>

      <Card title="How deep the ladder goes">
        <p className="pm-how-text">
          The ladder runs from the break-even (or today's price, if lower) down to a <b>floor</b>: the average cost of the shares less the stock's <b>Max drawdown</b>, the deepest fall it has had in the last <Value>{ladder.shockLookbackYears}</Value> years. Pluto keeps that fall between <Value>{pct(ladder.shockMinPct)}</Value> and <Value>{pct(ladder.shockMaxPct)}</Value>, and uses <Value>{pct(ladder.shockNoHistoryPct)}</Value> for a stock with less than a year of history. The more of the reserve is already used, the lower the next Put's strike must be.
        </p>
        <p className="pm-how-note">
          Example: shares bought at an average of {formatCurrency(example.averageCost)}, break-even {formatCurrency(example.breakEven)} after premiums, Max drawdown {pct(example.shockPct)}, so the floor is {formatCurrency(example.averageCost)} × {pct(100 - example.shockPct)} = {formatCurrency(example.floor)}.
        </p>
        <div className="pm-how-bars">
          <Bar label="Average cost" value={example.averageCost} widthPct={100} tone="call" />
          <Bar label="Break-even" value={example.breakEven} widthPct={(example.breakEven / example.averageCost) * 100} tone="call" />
          {example.rungs.map((entry) => (
            <Bar key={entry.rung} label={`Put rung ${entry.rung}`} value={entry.strikeCap} widthPct={(entry.strikeCap / example.averageCost) * 100} tone="put" />
          ))}
        </div>
        <p className="pm-how-note">
          The highest strike each Put may have, when every earlier rung is an open Put using its full {formatCurrency(example.rungCollateral, 0)} and nothing has been assigned. Rung {example.rungs.length} sits on the floor. An assignment lowers the average cost and the break-even, and the ladder below moves down with them.
        </p>
        <details className="pm-how-formula">
          <summary>The formula</summary>
          <div className="pm-how-formula-body">
            <div className="pm-how-formula-line">Highest Put strike = A − (A − F) × (U + Q) ÷ R0</div>
            <div><Value>A</Value>: the break-even per share, or today's price if lower</div>
            <div><Value>F</Value>: the floor, the shares' average cost × (1 − Max drawdown)</div>
            <div><Value>R0</Value>: the reserve, {pct(100 - ladder.sharesPct)} of the pot</div>
            <div><Value>U</Value>: the reserve already used: shares at cost plus open Puts' strike × 100, less the shares' part of the pot (never below 0)</div>
            <div><Value>Q</Value>: this rung's cash, R0 ÷ {ladder.rungs} or what is left of the reserve if less</div>
            {firstRung && (
              <div className="muted">
                Rung 1 above: {formatCurrency(example.breakEven)} − ({formatCurrency(example.breakEven)} − {formatCurrency(example.floor)}) × ({formatCurrency(0, 0)} + {formatCurrency(example.rungCollateral, 0)}) ÷ {formatCurrency(example.reserve, 0)} = {formatCurrency(firstRung.strikeCap)}.
              </div>
            )}
          </div>
        </details>
      </Card>

      <Card title="Which contracts Pluto sells">
        <p className="pm-how-text muted">Among the contracts that pass every rule, Pluto sells the one with the highest premium yield. If that contract's trading volume limits the size, the rest goes to the next best.</p>
        <RuleTable heading="Rule" rows={contractRules} />
      </Card>

      <div className="pm-how-pair">
        <Card title="Before every order">
          <ul className="pm-how-list">
            <li>Pluto asks IBKR for a fresh price of the contract and checks the contract rules again on it: the bid, the spread, the days to expiry, the opening yield, and the delta for a Call or a Put that opens a cycle. If one fails, nothing is sent and the sale is planned again at a later look; a price without a time is not used.</li>
            <li>The order's price is the middle of the bid and the ask, rounded to the cent: up for a sale, so it is never below the middle.</li>
            <li>An order not filled within <Value>{shared.unfilledOrderCancelMinutes}</Value> minutes is cancelled; Pluto plans afresh at its next look.</li>
            <li>Per ticker: at most <Value>{ladder.maxWorkingOrdersPerTicker}</Value> orders working at once, <Value>{ladder.maxOrdersPerTickerPerDay}</Value> orders a day and <Value>{ladder.maxOpenPositionsPerTicker}</Value> open positions.</li>
            <li>All tickers together: at most <Value>{ladder.maxOpenPositions}</Value> open positions and working orders, <Value>{ladder.maxOrdersPerDay}</Value> orders a day, and never more money committed than the capital budget, <Value>{pct(shared.capitalBudgetPct)}</Value> of the account. Sales beyond a limit wait for a later look.</li>
            <li>The order route checks the ticker's pot, the capital budget across all tickers and the cash reserve one last time.</li>
            <li>A routine order problem (the price moved, no fresh price, or IBKR refusing the price or the margin) only skips that order: it is planned again at the next look. Any other order error pauses Pluto until someone looks.</li>
          </ul>
        </Card>
        <Card title="When Pluto holds back">
          <ul className="pm-how-list">
            <li>SPY is down <Value>{pct(ladder.spyStressBreakerPct)}</Value> or more on the day: no new orders until it recovers, or someone turns on the override for the day.</li>
            <li>The account is down <Value>{pct(shared.dailyLossBreakerPct)}</Value> or more on the day. A real loss stops Pluto until someone resets it.</li>
            {ladder.tickerCooldownMinutes > 0 && <li>A ticker rests <Value>{ladder.tickerCooldownMinutes}</Value> minutes after a fill.</li>}
            <li>Outside Pluto's window, <Value>{shared.windowStartEt}</Value> to <Value>{shared.windowEndEt}</Value> ET (ending at least {shared.windowEndMinutesBeforeCloseAtLeast} minutes before the close).</li>
            <li>Any of Pluto's usual checks fails: IBKR not connected, the books not matching IBKR.</li>
            <li>Each day's first orders wait for Pluto's opening look, once the day's ladder prices are in: they are quoted from 9:30 ET.</li>
            <li>A stock split: the ticker is frozen, its orders cancelled, and a Telegram alert asks for the records to be updated.</li>
            <li>A ticker that cannot trade (no option volume from the previous session, no shock, prices too old) or whose sales are held by a limit: a Telegram message at most once a day for each reason.</li>
          </ul>
        </Card>
      </div>

      <Card title="What Pluto does not do">
        <ul className="pm-how-list">
          <li>It never buys an option back early. Every option is held until it expires, is assigned or is called away.</li>
          <li>It has no stop-loss and never sells the shares below the break-even: a fall is met with the Put ladder instead.</li>
          <li>It does not avoid earnings dates. Options may run across an earnings report.</li>
        </ul>
      </Card>
    </>
  );
}

function VolFarmerV2Explanation({ values }: { values: PlutoHowItWorks }) {
  const { volFarmerV2: v2, shared, ladder } = values;
  const { example } = v2;
  const halfPot = example.pot / 2;
  const implied = v2.stepRule === "implied_move_at_put_sale";
  return (
    <>
      <div className="pm-how-pair">
        <Card title="In plain words">
          <p className="pm-how-lead">
            Vol Farmer v2 earns option premium on a stock in two <b>positions</b>. Half the ticker's pot buys shares, the first position, and sells <b>Calls</b> on them, always at or above what the shares cost after the premiums already collected: the first position's break-even, <b>B-E¹</b>.
          </p>
          <p className="pm-how-text">
            When the best such Call pays less than <Value>{pct(v2.putsStartCallYieldPct)}</Value> a year, usually after the stock has fallen, the other half of the pot sells <b>Puts</b> well below B-E¹. If a Put is assigned, its shares become the second position, bought cheaper, which sells Calls of its own at or above its break-even, <b>B-E²</b>.
          </p>
          <p className="pm-how-text">
            If even the second position finds no Call at or above B-E², Pluto buys a <b>LEAPS</b>: a Call <Value>{v2.leapsMinDte}</Value> or more days out that gains as the stock recovers. It is sold as soon as the second position's shares are called away, even at a loss.
          </p>
          <p className="pm-how-text muted">Pluto looks at every v2 ticker at every round, all day. Every order goes at the mid; one that does not fill is planned again at a later round.</p>
        </Card>
        <Card title="A worked example">
          <p className="pm-how-text">
            A {formatCurrency(example.accountValue, 0)} account, Pluto's budget {pct(shared.capitalBudgetPct)}, the ticker's allocation {pct(example.allocationPct)}: its pot is <b>{formatCurrency(example.pot, 0)}</b>.
          </p>
          <ol className="pm-how-list">
            <li>The stock is at {formatCurrency(example.stockPrice)}. Half the pot, {formatCurrency(halfPot, 0)}, buys <b>{example.lots} lots</b> ({example.lots * 100} shares), with a Call sold on them.</li>
            <li>After a fall, what the shares cost less their premiums (B-E¹) is {formatCurrency(example.firstBreakEven)}, and no Call at or above {formatCurrency(example.firstBreakEven)} pays {pct(v2.putsStartCallYieldPct)} a year.</li>
            <li>
              {implied ? <>The stock's options price a {pct(example.impliedVolatilityPct)} yearly move, so the Step is {pct(example.impliedVolatilityPct)} × √(21 ÷ 252) = <b>{pct(example.stepPct)}</b></> : <>The Step is a fixed <b>{pct(example.stepPct)}</b></>}: Puts are sold struck at most {formatCurrency(example.firstBreakEven)} × (1 − {pct(example.stepPct)}) = <b>{formatCurrency(example.putStrikeCap)}</b>, with the other {formatCurrency(halfPot, 0)}.
            </li>
            <li>A LEAPS, if one is bought, spends at most {pct(v2.leapsMaxAllocationPct)} of the pot: <b>{formatCurrency(example.leapsCap, 0)}</b>, from Pluto's budget.</li>
          </ol>
        </Card>
      </div>

      <Card title="The rules and their numbers">
        <div className="pm-how-pair">
          <ul className="pm-how-list">
            <li>Calls: the next listed expiry, |delta| <Value>{formatDelta(v2.callMinAbsDelta)}–{formatDelta(v2.callMaxAbsDelta)}</Value>, at or above the position's break-even, the highest premium yield first.</li>
            <li>Bid at least <Value>{formatCurrencyTrimmed(v2.minimumBid)}</Value>, spread at most <Value>{pct(v2.maxSpreadPctOfMid)}</Value> of the mid, at most <Value>{pct(v2.maxVolumeSharePct)}</Value> of the contract's volume the session before.</li>
            <li>Puts start when the first position needs a new Call and the best one pays under <Value>{pct(v2.putsStartCallYieldPct)}</Value> a year.</li>
            <li>
              Put |delta| at most <Value>{formatDelta(v2.putMaxAbsDelta)}</Value>;{" "}
              {implied ? <>the Step from IBKR's latest 30-day IV of the last <Value>{v2.stepLookbackSessions}</Value> sessions, <Value>{pct(v2.stepBelowFirstBreakEvenPct)}</Value> without one.</> : <>the Step a fixed <Value>{pct(v2.stepBelowFirstBreakEvenPct)}</Value> below B-E¹.</>}
            </li>
          </ul>
          <ul className="pm-how-list">
            <li>LEAPS: the first expiry <Value>{v2.leapsMinDte}</Value> or more days out, |delta| nearest <Value>{formatDelta(v2.leapsAbsDelta)}</Value>, at most <Value>{pct(v2.leapsMaxAllocationPct)}</Value> of the ticker's pot.</li>
            <li>Short of its count when bought, the LEAPS is topped up with the same contract at the next rounds.</li>
            <li>The caps under the CC + Put Ladder's safety settings count v2's orders too. While SPY is down <Value>{pct(ladder.spyStressBreakerPct)}</Value> or more on the day, v2 opens nothing; a LEAPS sale still goes.</li>
            <li>Every order but a LEAPS is held to the ticker's pot; a LEAPS to Pluto's budget across every ticker.</li>
          </ul>
        </div>
        <p className="pm-how-note">A ticker Pluto already held when it switched to v2 keeps its holdings: every share joins the first position at the cycle's break-even, its open Calls stay the first position's, its open Puts the second's. A ticker holding only Puts waits until they expire or are assigned.</p>
      </Card>
    </>
  );
}

type HowItWorksStrategy = "vol_farmer_v2" | "cc_put_ladder";

const strategyStorageKey = "iorio-pluto-how-it-works-strategy";

function readStoredStrategy(): HowItWorksStrategy {
  try {
    return localStorage.getItem(strategyStorageKey) === "cc_put_ladder" ? "cc_put_ladder" : "vol_farmer_v2";
  } catch {
    return "vol_farmer_v2";
  }
}

export function PlutoHowItWorksTab() {
  const [values, setValues] = useState<PlutoHowItWorks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<HowItWorksStrategy>(readStoredStrategy);

  function choose(next: HowItWorksStrategy) {
    setStrategy(next);
    try {
      localStorage.setItem(strategyStorageKey, next);
    } catch {
      // Private window or blocked storage: the choice just isn't remembered.
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchPlutoHowItWorks()
      .then((loaded) => {
        if (!cancelled) setValues(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load how Pluto works."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (values === null) return <div className="py-4"><Spinner label="Loading how Pluto works" /></div>;

  return (
    <div className="pm-how">
      <div className="pm-seg pm-how-strategies" role="tablist" aria-label="Strategy">
        {(["vol_farmer_v2", "cc_put_ladder"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={strategy === key} className={strategy === key ? "on" : ""} onClick={() => choose(key)}>
            {plutoStrategyLabels[key]}
          </button>
        ))}
      </div>
      {strategy === "vol_farmer_v2" ? <VolFarmerV2Explanation values={values} /> : <LadderExplanation values={values} />}
    </div>
  );
}
