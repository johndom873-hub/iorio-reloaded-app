import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { fetchPlutoHowItWorks, type PlutoHowItWorks } from "../../api/pluto";
import { formatCurrency, formatCurrencyTrimmed, formatDelta, formatPercentageValueTrimmed } from "../../lib/formatters";
import { Spinner } from "../Spinner";

// Pluto's "How it works" tab (approved mockups https://claude.ai/artifact/TYdARe8Sa6RuF5Lb1E1s2b and, for Vol Farmer v4,
// https://claude.ai/artifact/QGwKxNa7orZFFjfeRBnhoU; the CC + Put Ladder's part retired 2026-11-02): a plain-language
// explanation of Vol Farmer v4 for readers who do not read code. Every number comes from GET /pluto/how-it-works (Pluto's live settings and the code's own constants); only
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

function VolFarmerV4Explanation({ values }: { values: PlutoHowItWorks }) {
  const { volFarmerV4: v4, shared, safetyLimits } = values;
  const { example } = v4;
  const firstPositionDollars = (example.pot * v4.firstPositionPct) / 100;
  const implied = v4.stepRule === "implied_move_at_put_sale";
  const sameDay = v4.optionsExpiry === "today";
  const bothPositions = v4.rebalances === "both_positions";
  const callFloor = v4.callStrikeFloor === "break_even" ? "at or above the position's break-even" : "anywhere above the stock's price";
  const fallLots = example.lotsAfterFallTopUp - example.lots;
  const fallOutsideBand = Math.abs(example.valueAfterFall - example.targetDollars) > example.bandDollars;
  const riseLots = example.lots - example.lotsAfterRiseTrim;
  return (
    <>
      <div className="pm-how-pair">
        <Card title="In plain words">
          <p className="pm-how-lead">
            Vol Farmer v4 holds a stock and earns option premium on it. <Value>{pct(v4.firstPositionPct)}</Value> of the ticker's pot buys shares, the first position, and sells <b>Calls</b> on them {callFloor}
            {sameDay ? <>, expiring at <b>that day's close</b>, on the days an expiry ends then: the Calls never cover a night.</> : <>, on the next expiry.</>}
          </p>
          <p className="pm-how-text">
            The shares are kept near their share of the pot. Between Calls, when their value is more than <Value>{pct(v4.rebalanceBandPct)}</Value> of the pot away from {pct(v4.firstPositionPct)} of it, Pluto buys or sells whole lots to bring them back{bothPositions ? <>, counting the second position's shares too</> : null}{v4.topUpCapPct > 0 ? <>; it never buys past the point where the ticker has <Value>{pct(v4.topUpCapPct)}</Value> of its pot in shares and Puts' cash, so a stock that keeps falling is not chased all the way down</> : null}. A share order goes on its own: the ticker's option orders wait until it ends{sameDay ? <>, and on a day no expiry ends Pluto only rebalances, a new cycle buying its shares alone</> : null}.
          </p>
          <p className="pm-how-text">
            {v4.putsSold === "with_every_call" ? <>The rest of the pot sells <b>Puts</b> with every Call the first position sells</> : <>When the best Call pays less than <Value>{pct(v4.putsStartCallYieldPct)}</Value> a year (the premium's return × <Value>{shared.premiumYieldSessionsPerYear}</Value> ÷ the trading sessions it is held, the one it is sold in and its expiry's both counted), usually after the stock has fallen, the rest of the pot sells <b>Puts</b></>}
            {v4.putStrikeCap === "first_break_even_less_step" ? <> well below the first position's break-even, <b>B-E¹</b></> : <> below the stock's price</>}. If a Put is assigned, its shares become the second position, bought cheaper, which sells Calls of its own.
          </p>
          <p className="pm-how-text">
            Once the stock is half a Step below the second position's break-even, <b>B-E²</b>, Pluto buys a <b>LEAPS</b>: a Call <Value>{v4.leapsMinDte}</Value> or more days out that gains as the stock recovers. It is sold as soon as the second position's shares are gone, even at a loss.
          </p>
          <p className="pm-how-text">
            The v4 tickers share Pluto's budget. Each ticker's pot is its allocation of the budget, raised by the excess allowance (<Value>{pct(shared.excessAllowancePct)}</Value> now), so the pots can add up to more than the budget. The account is a cash account: a purchase or a Put uses only cash that has settled, so Pluto counts the smallest of the budget's free cash, the account's and the settled cash left.
          </p>
          <p className="pm-how-text muted">Pluto looks at every v4 ticker at every round, all day. Every order goes at the mid; one that does not fill is planned again at a later round.</p>
        </Card>
        <Card title="A worked example">
          <p className="pm-how-text">
            A {formatCurrency(example.accountValue, 0)} account, Pluto's budget {pct(shared.capitalBudgetPct)}, the ticker's allocation {pct(example.allocationPct)}{shared.excessAllowancePct > 0 && <>, the excess allowance {pct(shared.excessAllowancePct)}</>}: its pot is <b>{formatCurrency(example.pot, 0)}</b>.
          </p>
          <ol className="pm-how-list">
            <li>The stock is at {formatCurrency(example.stockPrice)}. {pct(v4.firstPositionPct)} of the pot, {formatCurrency(firstPositionDollars, 0)}, buys <b>{example.lots} lots</b> ({example.lots * 100} shares), with a Call sold on them.</li>
            <li>
              The shares are kept within {formatCurrency(example.bandDollars, 0)} of {formatCurrency(example.targetDollars, 0)}. A fall to {formatCurrency(example.fallPrice)} leaves them worth {formatCurrency(example.valueAfterFall, 0)}
              {fallLots > 0 ? <>: Pluto buys <b>{fallLots} lots</b>, back to {example.lotsAfterFallTopUp}</> : fallOutsideBand ? <>, under the band, but the top-up cap leaves no room: nothing is bought</> : <>, still inside the band: nothing is bought</>}
              {example.topUpCapDollars !== null && fallOutsideBand ? <> (the money in becomes {formatCurrency(example.moneyInAfterFallTopUp)}, under the cap of {formatCurrency(example.topUpCapDollars, 0)})</> : null}. A rise to {formatCurrency(example.risePrice)} makes them {formatCurrency(example.valueAfterRise, 0)}
              {riseLots > 0 ? <>: Pluto sells <b>{riseLots} lots</b>, back to {example.lotsAfterRiseTrim}</> : <>, still inside the band: nothing is sold</>}.
            </li>
            <li>After a fall, what the shares cost less their premiums (B-E¹) is {formatCurrency(example.firstBreakEven)}.</li>
            <li>
              {implied ? <>The stock's options price a {pct(example.impliedVolatilityPct)} yearly move, so the Step is {pct(example.impliedVolatilityPct)} × √(21 ÷ 252) = <b>{pct(example.stepPct)}</b></> : <>The Step is a fixed <b>{pct(example.stepPct)}</b></>}
              {v4.putStrikeCap === "first_break_even_less_step" ? <>: Puts are sold struck at most {formatCurrency(example.firstBreakEven)} × (1 − {pct(example.stepPct)}) = <b>{formatCurrency(example.putStrikeCap)}</b></> : <>; the Puts may be struck anywhere below the price</>}, with the rest of the pot, {formatCurrency(example.pot - firstPositionDollars, 0)}.
            </li>
            <li>If a Put is assigned, a LEAPS is bought once the stock is half that Step, <b>{pct(example.leapsEntryBelowSecondBreakEvenPct)}</b>, below B-E², and spends at most {pct(v4.leapsMaxAllocationPct)} of the pot: <b>{formatCurrency(example.leapsCap, 0)}</b>, from Pluto's budget.</li>
          </ol>
        </Card>
      </div>

      <Card title="The rules and their numbers">
        <div className="pm-how-pair">
          <ul className="pm-how-list">
            <li>
              Calls: {sameDay ? <>the expiry ending at today's close, on the days one does</> : <>the next listed expiry, if it is <Value>{v4.optionsMaxDaysToExpiry}</Value> days or fewer away</>}, |delta| <Value>{formatDelta(v4.callMinAbsDelta)}–{formatDelta(v4.callMaxAbsDelta)}</Value>, {callFloor}, the highest premium yield first.
            </li>
            <li>Bid at least <Value>{formatCurrencyTrimmed(v4.minimumBid)}</Value>, spread at most <Value>{pct(v4.maxSpreadPctOfMid)}</Value> of the mid, at most <Value>{pct(v4.maxVolumeSharePct)}</Value> of the contract's volume the session before.</li>
            <li>
              Rebalancing: when the first position has no Call open, its shares{bothPositions ? <> and the second position's</> : null} are traded back to <Value>{pct(v4.firstPositionPct)}</Value> of the pot once they are more than <Value>{pct(v4.rebalanceBandPct)}</Value> of the pot away from it, in whole lots, never below one lot. A purchase uses the free cash; a sale sells only shares no Call covers
              {bothPositions ? (v4.trimsSell === "higher_break_even_first" ? <>, the position with the higher break-even first</> : <>, the second position's first</>) : null}. The share order goes alone, at the mid of Pluto's stock quote.
            </li>
            <li>
              {v4.topUpCapPct > 0 ? (
                <>
                  Top-up cap: a purchase takes the ticker's money in (what its shares cost, the second position's at their assigned strikes, plus the cash its open Puts hold) to at most <Value>{pct(v4.topUpCapPct)}</Value> of the pot, buying only the lots the room left pays for. A new cycle's first purchase, Calls, Puts, sales and LEAPS are not capped.
                </>
              ) : (
                <>Top-up cap: none; a purchase buys every lot rebalancing wants that the free cash pays for.</>
              )}
            </li>
            <li>{v4.putsSold === "with_every_call" ? <>Puts are sold with every Call the first position sells.</> : <>Puts start when the first position needs a new Call and the best one pays under <Value>{pct(v4.putsStartCallYieldPct)}</Value> a year.</>}</li>
            <li>
              Put |delta| at most <Value>{formatDelta(v4.putMaxAbsDelta)}</Value>
              {v4.putStrikeCap === "first_break_even_less_step" ? <>; struck at most a Step below B-E¹, {implied ? <>the Step from IBKR's 30-day IV of the session before (without it, no Put and no new LEAPS that day)</> : <>the Step a fixed <Value>{pct(v4.stepBelowFirstBreakEvenPct)}</Value></>}.</> : <>; struck anywhere below the price.</>}
            </li>
          </ul>
          <ul className="pm-how-list">
            <li>LEAPS: bought once the stock is half a Step below B-E², whatever the Calls; the first expiry <Value>{v4.leapsMinDte}</Value> or more days out, |delta| nearest <Value>{formatDelta(v4.leapsAbsDelta)}</Value>, at most <Value>{pct(v4.leapsMaxAllocationPct)}</Value> of the ticker's pot; one per holding of the second position, topped up while the stock is below B-E².</li>
            <li>{v4.firstPositionAfterCalledAway === "wait" ? <>A first position called away while the second still holds shares is not rebuilt: the next cycle waits for the second to go.</> : <>A first position called away while the second still holds shares is rebuilt at the next round, its shares bought with its Call.</>}</li>
            <li>The Safety Limits cap v4's orders and positions. While SPY is down <Value>{pct(safetyLimits.spyStressBreakerPct)}</Value> or more on the day, v4 opens nothing; a sale of a LEAPS or of shares still goes.</li>
            <li>Every order but a LEAPS is held to the ticker's pot; a LEAPS to Pluto's budget across every ticker.</li>
            <li>A purchase and a Put are no more than the free cash pays for: the smallest of Pluto's budget left, the account's free cash and the settled cash left (IBKR's settled cash less the cash the open Puts hold and the orders working). With no settled cash reported, nothing is bought.</li>
            <li>The v4 tickers take turns at each round in alphabetical order, starting one ticker further each day. A LEAPS is bought or topped up after every ticker's other orders, with the free cash they left.</li>
          </ul>
        </div>
        <p className="pm-how-note">A ticker Pluto already held keeps its holdings: every share joins the first position at the cycle's break-even, its open Calls stay the first position's, its open Puts the second's. A ticker holding only Puts waits until they expire or are assigned.</p>
      </Card>
    </>
  );
}

export function PlutoHowItWorksTab() {
  const [values, setValues] = useState<PlutoHowItWorks | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <VolFarmerV4Explanation values={values} />
    </div>
  );
}
