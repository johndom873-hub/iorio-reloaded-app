import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { fetchPlutoHowItWorks, type PlutoHowItWorks } from "../../api/pluto";
import { formatCurrency, formatCurrencyTrimmed, formatDelta, formatPercentageValueTrimmed } from "../../lib/formatters";
import { executionStrategyLabels } from "../../lib/plutoParameters";
import { Spinner } from "../Spinner";

// Pluto's "How it works" tab (approved mockup https://claude.ai/artifact/TYdARe8Sa6RuF5Lb1E1s2b): a plain-language
// explanation of each execution strategy for readers who do not read code, opening on the active one. Every number
// comes from GET /pluto/how-it-works (Pluto's live settings and the code's own constants); only the wording lives
// here, so a change to a rule the text describes must update this file too (API CLAUDE.md).

type ExecutionStrategy = PlutoHowItWorks["activeStrategy"];

const strategies: { key: ExecutionStrategy; label: string }[] = [
  { key: "cc_put_ladder", label: executionStrategyLabels.cc_put_ladder },
  { key: "edge_margin", label: executionStrategyLabels.edge_margin },
];

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
            <li>Any of Pluto's usual checks fails: outside trading hours, IBKR not connected, the books not matching IBKR.</li>
            <li>Before 10:00 ET: the day's first orders wait for Pluto's morning price snapshot.</li>
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

function EdgeMarginExplanation({ values }: { values: PlutoHowItWorks }) {
  const { edgeMargin, shared } = values;
  const { example } = edgeMargin;
  const gradeCut = edgeMargin.gradeCutsPct[edgeMargin.minGrade];
  const liquidityParts = [edgeMargin.minOpenInterest > 0 ? `OI ≥ ${edgeMargin.minOpenInterest}` : null, edgeMargin.minSessionVolume > 0 ? `volume ≥ ${edgeMargin.minSessionVolume}` : null].filter((part): part is string => part !== null);
  const liquidityMeaning = [edgeMargin.minOpenInterest > 0 ? `${edgeMargin.minOpenInterest} open contracts` : null, edgeMargin.minSessionVolume > 0 ? `${edgeMargin.minSessionVolume} traded today` : null].filter((part): part is string => part !== null);
  const standardOrderPct = (shared.capitalBudgetPct * edgeMargin.orderSizePctOfBudget) / 100;
  const tickerCapPctOfAccount = (shared.capitalBudgetPct * edgeMargin.maxTickerPctOfBudget) / 100;
  const kellyShare = edgeMargin.kellyFraction === 0.5 ? "half" : `${edgeMargin.kellyFraction} times`;
  const contractRules = [
    { name: "Grade", value: `${edgeMargin.minGrade} or better`, meaning: gradeCut > 0 ? `Edge margin of at least ${pct(gradeCut)}: the market pays at least ${pct(gradeCut)} more than the fair price.` : "Edge margin of at least 0%: the market pays at least the fair price." },
    { name: "Edge Yield", value: `≥ ${pct(edgeMargin.minEdgeYieldPct)} a year`, meaning: "The expected profit after costs, against the money at risk, per year." },
    { name: "Premium yield", value: `≥ ${pct(edgeMargin.minAnnualizedYieldPct)} a year`, meaning: "The premium itself, against the money at risk, per year." },
    { name: "Delta", value: `≤ ${formatDelta(edgeMargin.maxAbsDelta)}`, meaning: `At most about a ${pct(edgeMargin.maxAbsDelta * 100)} chance of ending in the money.` },
    { name: "Days to expiry", value: `${edgeMargin.minDte}–${edgeMargin.maxDte}`, meaning: `Contracts expiring ${edgeMargin.minDte} to ${edgeMargin.maxDte} days from today.` },
    { name: "Spread", value: `≤ ${pct(edgeMargin.maxSpreadPct)} of the mid`, meaning: `The gap between bid and ask must be at most ${pct(edgeMargin.maxSpreadPct)} of the middle price, so the price is fair.` },
    { name: "Liquidity", value: liquidityParts.length > 0 ? liquidityParts.join(", ") : "no minimum", meaning: liquidityMeaning.length > 0 ? `At least ${liquidityMeaning.join(" and ")}.` : "No minimum open interest or volume." },
    { name: "Fresh price", value: `≤ ${edgeMargin.maxQuoteAgeMinutes} min`, meaning: "The quote must be recent." },
    { name: "Model fit", value: "tight", meaning: "The model must fit the day's prices closely; otherwise its fair price cannot be trusted." },
    { name: "Earnings", value: "avoided", meaning: "No expiry that runs across a known earnings date." },
    { name: "Big move", value: `≤ ${edgeMargin.maxDayMoveMultiple}× a normal day`, meaning: `A ticker moving more than ${edgeMargin.maxDayMoveMultiple} normal days today is skipped.` },
    { name: "Room for an order", value: "≥ 1 contract", meaning: "The size limits below, counting the positions and orders already on the ticker, must allow at least one contract. A contract they allow none of is never shown to the AI." },
  ];
  const sizeLimits = [
    { name: "Capital budget", value: pct(shared.capitalBudgetPct), meaning: `Everything on the tickers Pluto trades, human positions there included (hedges aside), stays under ${pct(shared.capitalBudgetPct)} of the account.` },
    { name: "Standard order", value: pct(standardOrderPct), meaning: `One order uses at most ${pct(edgeMargin.orderSizePctOfBudget)} of the budget.` },
    { name: "Per ticker", value: `${pct(edgeMargin.maxTickerPctOfBudget)} of budget`, meaning: `At most ${pct(edgeMargin.maxTickerPctOfBudget)} of the budget (${pct(tickerCapPctOfAccount)} of the account) on one ticker, counting human positions too.` },
    { name: "Cash reserve", value: pct(edgeMargin.minCashReservePct), meaning: "This much cash always stays free." },
    { name: "Volume", value: `≤ ${pct(edgeMargin.maxContractsVolumeSharePct)} of today`, meaning: `At most ${pct(edgeMargin.maxContractsVolumeSharePct)} of the contracts traded today.` },
    edgeMargin.stressRiskBudgetPct > 0
      ? { name: "Stress", value: `${pct(edgeMargin.stressRiskBudgetPct)} at ${edgeMargin.stressSigmas}σ`, meaning: `A large move against the position (${edgeMargin.stressSigmas} standard deviations to expiry) may cost at most ${pct(edgeMargin.stressRiskBudgetPct)} of the account.` }
      : { name: "Stress", value: "off", meaning: "No limit on the loss in a large move." },
    { name: "Kelly sizing", value: `${edgeMargin.kellyFraction} × Kelly`, meaning: `Kelly sizes a bet from its expected profit and its risk; Pluto bets ${kellyShare} of it. No edge, no trade.` },
    { name: "Open positions", value: `≤ ${edgeMargin.maxOpenPositions}`, meaning: `New trades stop at ${edgeMargin.maxOpenPositions} open positions.` },
  ];

  return (
    <>
      <Card title="Edge Margin">
        <p className="pm-how-lead">
          Pluto's valuation model puts a fair price on every option. Pluto looks for options the market pays <b>more</b> for than that fair price, and sells them: cash-secured Puts and Covered Calls. An AI model reads a short list of the best ones and picks at most one trade per round, or none.
        </p>
        <p className="pm-how-text muted">The AI only chooses from the list. It never sets the strike, the expiry, the number of contracts or the price: the code does, and it re-checks the AI's choice before anything is sent.</p>
      </Card>

      <Card title="One round, step by step">
        <div className="pm-how-steps">
          <Step number={1} tone="call" title="Watch the prices">
            Between <Value>{edgeMargin.windowStartEt}</Value> and <Value>{edgeMargin.windowEndEt}</Value> ET (ending at least {edgeMargin.windowEndMinutesBeforeCloseAtLeast} minutes before the close), Pluto starts a round whenever a ticker's option prices change, or when an order ends or a position closes.
          </Step>
          <Step number={2} tone="call" title="Value and filter">
            The model values every contract. Only those graded <b>{edgeMargin.minGrade}</b> or better that pass every rule below go on. The best <Value>{edgeMargin.burstLines}</Value> get a fresh live price.
          </Step>
          <Step number={3} tone="call" title="The AI picks one, or none">
            The AI sees the top <Value>{edgeMargin.candidatesPerTickerPerStrategy}</Value> per ticker, ranked by Edge Yield, plus any rolls and buybacks on offer. It picks one with a confidence; below <Value>{edgeMargin.confidenceFloor}</Value> the pick is refused.
          </Step>
          <Step number={4} tone="call" title="The code checks, sizes and sends">
            The pick is re-valued on a fresh price; if its edge margin moved more than <Value>{edgeMargin.maxEdgeMarginDriftPts}</Value> points, it is dropped. The code then sizes it (below) and sends it at the middle of the bid and the ask, rounded to the cent: up for a sale, down for a buyback, so neither gives up anything past the middle.
          </Step>
        </div>
      </Card>

      <Card title={`What "edge" means, with an example`}>
        <p className="pm-how-text muted">
          Example: {example.contractLabel}. Its exposure is (strike − price) × 100 = ({formatCurrencyTrimmed(example.strike)} − {formatCurrency(example.mid)}) × 100 = {formatCurrency(example.exposure, 0)}.
        </p>
        <div className="pm-how-figures">
          <Figure tone="plain" label="Market price (mid) / fair price" value={`${formatCurrency(example.mid)} / ${formatCurrency(example.fair)}`} detail={`The market pays ${Math.round((example.mid - example.fair) * 100)} cents more than the model's fair value`} />
          <Figure tone="call" label="Edge margin" value={`${pct(example.edgeMarginPct)} · ${example.grade}`} detail={`1 − ${example.fair} ÷ ${example.mid.toFixed(2)}. Grades: strong ≥ ${pct(edgeMargin.gradeCutsPct.strong)}, good ≥ ${pct(edgeMargin.gradeCutsPct.good)}, weak ≥ ${pct(edgeMargin.gradeCutsPct.weak)}`} />
          <Figure tone="call" label="Edge $" value={formatCurrencyTrimmed(Math.round(example.edgeDollars * 100) / 100)} detail={`${formatCurrencyTrimmed(Math.round((example.mid - example.fair) * 10_000) / 100)} a contract, less about ${formatCurrencyTrimmed(example.frictionDollars)} of spread and commission`} />
          <Figure
            tone="call"
            label="Edge Yield"
            value={`${formatPercentageValueTrimmed(example.edgeYieldPct, 1)} a year`}
            detail={`${Math.round(example.edgeDollars)} ÷ ${example.exposure.toLocaleString("en-US")} × 365 ÷ ${example.daysToExpiry}. ${example.passesMinEdgeYield ? "Passes" : "Below"} the ${pct(edgeMargin.minEdgeYieldPct)} minimum`}
          />
        </div>
      </Card>

      <Card title="Which contracts reach the AI">
        <RuleTable heading="Rule" rows={contractRules} />
      </Card>

      <Card title="How big each order is">
        <p className="pm-how-text muted">The number of contracts is the smallest that every one of these limits allows. Percentages are of the account value unless they say budget.</p>
        <RuleTable heading="Limit" rows={sizeLimits} />
      </Card>

      <div className="pm-how-pair">
        <Card title="Shares and exits">
          <ul className="pm-how-list">
            <li><b>Shares held</b> (for example after a Put is assigned): the code sells a Call on every 100 shares itself, without the AI, at or above the break-even, and only if being called away earns at least <Value>{pct(edgeMargin.heldShareCallMinProfitPct)}</Value> or <Value>{formatCurrencyTrimmed(edgeMargin.heldShareCallMinProfitDollars)}</Value>.</li>
            <li><b>Buying a Put back early</b> is offered to the AI when keeping it is worth less than closing it, the close is at a profit and at least <Value>{edgeMargin.buybackMinDte}</Value> days are left; or when <Value>{pct(edgeMargin.buybackUnscoredMinKeptPremiumPct)}</Value> of the premium is already earned and the model cannot value it.</li>
            <li><b>Before earnings</b> (the last <Value>{edgeMargin.earningsCloseWindowSessions}</Value> sessions), automatically: a Put in profit is bought back; a Covered Call in profit is closed whole.</li>
            <li><b>Before a major economic release</b> (the last <Value>{edgeMargin.eventCloseWindowSessions}</Value> sessions), the same closes are offered to the AI.</li>
            <li><b>Rolls</b>: the AI may roll a position to a later or safer contract for a credit, re-checked like a new trade.</li>
            <li><b>Shares in profit</b> are offered to the AI for sale once the cycle is up at least <Value>{pct(edgeMargin.heldShareCallMinProfitPct)}</Value> or <Value>{formatCurrencyTrimmed(edgeMargin.heldShareCallMinProfitDollars)}</Value>; fewer than 100 shares are sold automatically.</li>
          </ul>
        </Card>
        <Card title="When Pluto holds back">
          <ul className="pm-how-list">
            <li>SPY is down <Value>{pct(edgeMargin.spyStressBreakerPct)}</Value> or more on the day: no new trades; rolls and closes continue.</li>
            <li>The account is down <Value>{pct(shared.dailyLossBreakerPct)}</Value> or more on the day. A real loss stops Pluto until someone resets it.</li>
            <li><Value>{edgeMargin.maxActionsPerSession}</Value> actions in a session: from then on, closes only.</li>
            <li>{edgeMargin.tickerCooldownMinutes > 0 ? <>A ticker rests <Value>{edgeMargin.tickerCooldownMinutes}</Value> minutes after a fill, and has at most one working order.</> : "A ticker has at most one working order."}</li>
            <li>The AI failed <Value>{edgeMargin.consecutiveModelFailuresBreaker}</Value> times in a row, or today's AI cost passed <Value>{formatCurrencyTrimmed(edgeMargin.dailyCostCeilingUsd)}</Value>: rounds stop.</li>
            <li>Any of Pluto's usual checks fails: outside trading hours, IBKR not connected, the books not matching IBKR.</li>
            <li>Before the day's opening look: only positions already held are managed.</li>
          </ul>
        </Card>
      </div>

      <Card title="What Pluto does not do">
        <ul className="pm-how-list">
          <li>It never lets the AI set a strike, an expiry, a size or a price, and never trades a ticker the AI flagged as a concern.</li>
          <li>It never buys an option back at a loss, and never closes a Covered Call's Call on its own.</li>
          <li>It never sells an option that runs across a known earnings date, except the Calls on shares already held.</li>
          <li>It never changes the price of a working order: an order not filled within <Value>{shared.unfilledOrderCancelMinutes}</Value> minutes is cancelled, and a new round decides again.</li>
          <li>It does not stop for a routine order problem (the price moved, no fresh price, or IBKR refusing the price or the margin): that order is skipped and a later round decides again. Any other order error pauses Pluto until someone looks.</li>
        </ul>
      </Card>
    </>
  );
}

export function PlutoHowItWorksTab() {
  const [values, setValues] = useState<PlutoHowItWorks | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until the reader picks one: the tab opens on Pluto's active strategy.
  const [chosenStrategy, setChosenStrategy] = useState<ExecutionStrategy | null>(null);

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
  const shownStrategy = chosenStrategy ?? values.activeStrategy;

  return (
    <div className="pm-how">
      <div className="pm-how-switch">
        <span className="pm-note">Strategy</span>
        <div className="pm-seg" role="group" aria-label="Strategy to explain">
          {strategies.map((strategy) => (
            <button key={strategy.key} type="button" aria-pressed={shownStrategy === strategy.key} className={shownStrategy === strategy.key ? "on" : undefined} onClick={() => setChosenStrategy(strategy.key)}>
              {strategy.label}
              {values.activeStrategy === strategy.key && <span className="pm-how-active">Active</span>}
            </button>
          ))}
        </div>
        <span className="pm-note">Pluto runs one strategy at a time; it can only be switched while Pluto is off or paused.</span>
      </div>
      {shownStrategy === "cc_put_ladder" ? <LadderExplanation values={values} /> : <EdgeMarginExplanation values={values} />}
    </div>
  );
}
