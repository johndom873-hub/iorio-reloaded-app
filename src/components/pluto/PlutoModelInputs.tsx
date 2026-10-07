import { useId, useState } from "react";
import { fetchPlutoPass, type PlutoActionKind, type PlutoModelInput, type PlutoModelInputCloseAction, type PlutoModelInputContract, type PlutoModelInputRoll, type PlutoModelInputTicker } from "../../api/pluto";
import { errorMessage } from "../../api/client";
import { formatBrowserClockTimeWithSeconds, formatCurrency, formatDayMonth, formatNumber, formatSignedNumber, formatSignedPercentageValue } from "../../lib/formatters";
import { describeCandidateFlag, describeCandidateId, describeRecentDecisionVerdict, describeTradeOutcome, describeTrigger, groupMacroEventsByDate, parseBuybackDescription } from "../../lib/plutoPresentation";
import { Spinner } from "../Spinner";
import { GradeBadge, StrategyBadge } from "./plutoBits";

// The Event log's "What the model saw": a model call's full input, opened inside its row and loaded the first time
// it is opened (GET /pluto/passes/:id). One block per ticker, the tickers matching the log's ticker filter first.

type LoadState = { status: "idle" } | { status: "loading" } | { status: "ready"; input: PlutoModelInput | null } | { status: "error"; message: string };

export function PlutoModelInputsToggle({ passId, tickerFilter }: { passId: string; tickerFilter: string }) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const panelId = useId();

  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (!opening || load.status === "loading" || load.status === "ready") return;
    setLoad({ status: "loading" });
    fetchPlutoPass(passId)
      .then((pass) => setLoad({ status: "ready", input: pass.decisions.find((decision) => decision.inputPayload)?.inputPayload ?? null }))
      .catch((err) => setLoad({ status: "error", message: errorMessage(err, "Could not load what the model saw.") }));
  }

  return (
    <>
      <button type="button" className="pm-btn sm pm-seen-toggle" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        <i className={`pm-chev${open ? " up" : ""}`} aria-hidden="true" />
        {open ? "Hide what the model saw" : "Show what the model saw"}
      </button>
      {open && (
        <div id={panelId} className="pm-seen">
          {load.status === "loading" && <Spinner size="sm" label="Loading what the model saw" />}
          {load.status === "error" && <div className="alert alert-danger pm-error mb-0">{load.message}</div>}
          {load.status === "ready" && (load.input ? <ModelInputBody input={load.input} tickerFilter={tickerFilter} /> : <span className="muted">This pass kept no record of the model's input.</span>)}
        </div>
      )}
    </>
  );
}

function ModelInputBody({ input, tickerFilter }: { input: PlutoModelInput; tickerFilter: string }) {
  const filter = tickerFilter.trim().toUpperCase();
  const matchesFilter = (ticker: PlutoModelInputTicker) => filter !== "" && ticker.symbol.toUpperCase().includes(filter);
  const tickers = [...(input.tickers ?? [])].sort((a, b) => Number(matchesFilter(b)) - Number(matchesFilter(a)));
  const firstMacroTicker = tickers.find((ticker) => (ticker.macro_events ?? []).length > 0) ?? null;
  const spy = input.market?.spy_day_change_pct;
  return (
    <>
      <div className="pm-seen-head">
        <span>
          <b>What the model saw</b> at {formatBrowserClockTimeWithSeconds(input.as_of)}
        </span>
        {input.trigger && <span>Trigger: {describeTrigger({ trigger: input.trigger.kind, triggerDetail: input.trigger.detail ?? {} }, "short")}</span>}
        {spy !== undefined && <span>SPY {formatSignedPercentageValue(spy)} today</span>}
        {input.session && <span>{input.session.minutes_to_window_end} min left in the trading window</span>}
      </div>
      {tickers.map((ticker) => (
        <TickerBlock key={ticker.symbol} ticker={ticker} isFiltered={matchesFilter(ticker)} sameMacroAs={ticker !== firstMacroTicker && firstMacroTicker && sameMacroEvents(ticker, firstMacroTicker) ? firstMacroTicker.symbol : null} />
      ))}
      <div className="pm-seen-tk">
        {input.account && <AccountSection account={input.account} />}
        {input.parameters && <ParametersSection parameters={input.parameters} />}
        {(input.recent_decisions ?? []).length > 0 && <RecentDecisionsSection decisions={input.recent_decisions ?? []} />}
      </div>
    </>
  );
}

function sameMacroEvents(a: PlutoModelInputTicker, b: PlutoModelInputTicker): boolean {
  return JSON.stringify(a.macro_events ?? []) === JSON.stringify(b.macro_events ?? []);
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <span>
      <i>{label}</i> {value}
    </span>
  );
}

function present(value: number | undefined, render: (value: number) => string): string | null {
  return value === undefined || value === null ? null : render(value);
}

function TickerBlock({ ticker, isFiltered, sameMacroAs }: { ticker: PlutoModelInputTicker; isFiltered: boolean; sameMacroAs: string | null }) {
  const move = ticker.move_context ?? {};
  const meta = [ticker.sector, present(ticker.spot, (spot) => formatCurrency(spot)), present(ticker.day_change_pct, (change) => `${formatSignedPercentageValue(change)} today`), ticker.next_earnings ? `earnings ${formatDayMonth(ticker.next_earnings)}` : null].filter(Boolean).join(" · ");
  const moves = [move.change_1w_pct, move.change_1m_pct, move.change_3m_pct];
  const macro = groupMacroEventsByDate(ticker.macro_events ?? []);
  return (
    <div className="pm-seen-tk">
      <div className="pm-seen-tk-h">
        <span className="sym">{ticker.symbol}</span>
        {meta && <span className="meta">{meta}</span>}
        {isFiltered && <span className="pm-b info">Your filter</span>}
        {ticker.elevated_vol && <span className="pm-b warn">Elevated volatility</span>}
      </div>
      <div className="pm-seen-facts num">
        <Fact label="ATM IV" value={present(ticker.atm_iv, (value) => value.toFixed(1))} />
        <Fact label="Forecast RV" value={present(ticker.forecast_rv, (value) => value.toFixed(1))} />
        <Fact label="IV rank" value={present(move.iv_rank, (value) => formatNumber(value))} />
        <Fact label="Skew" value={present(ticker.skew_vp, (value) => `${formatSignedNumber(value, 1)} vp`)} />
        <Fact label="Expected daily move" value={present(move.expected_daily_move_pct, (value) => `${value.toFixed(1)}%`)} />
        <Fact label="Today" value={present(move.day_move_sigmas, (value) => `${formatSignedNumber(value)}σ`)} />
        <Fact label="RV 21d / 126d" value={move.realized_vol_21d !== undefined && move.realized_vol_126d !== undefined ? `${move.realized_vol_21d} / ${move.realized_vol_126d}` : null} />
        <Fact label="1w / 1m / 3m" value={moves.every((value) => value !== undefined) ? moves.map((value) => formatSignedPercentageValue(value, 1)).join(" / ") : null} />
        <Fact label="Momentum 12-1" value={present(ticker.momentum_12_1, (value) => formatSignedNumber(value))} />
        <Fact label="Open" value={(ticker.open_positions ?? []).length > 0 ? (ticker.open_positions ?? []).map((strategy) => strategy.replace(/_/g, " ")).join(", ") : null} />
      </div>
      {macro.length > 0 && (
        <div className="pm-seen-macro">
          <i>Macro events ({ticker.macro_events?.length}):</i> {sameMacroAs ? `same as ${sameMacroAs}` : macro.map((day) => `${formatDayMonth(day.date)} ${day.titles.join(", ")}`).join(" · ")}
        </div>
      )}
      {(ticker.close_actions ?? []).length > 0 && (
        <div className="pm-seen-sect">
          <span className="pm-seen-l">Close offers ({ticker.close_actions?.length})</span>
          {(ticker.close_actions ?? []).map((action) => <CloseOfferLine key={action.id} action={action} />)}
        </div>
      )}
      {(ticker.rolls ?? []).length > 0 && (
        <div className="pm-seen-sect">
          <span className="pm-seen-l">Rolls ({ticker.rolls?.length})</span>
          {(ticker.rolls ?? []).map((roll) => <RollLine key={roll.id} roll={roll} />)}
        </div>
      )}
      {(ticker.candidates ?? []).length > 0 && (
        <div className="pm-seen-sect">
          <span className="pm-seen-l">Candidates ({ticker.candidates?.length})</span>
          {(ticker.candidates ?? []).map((candidate) => <CandidateLine key={candidate.id} candidate={candidate} />)}
        </div>
      )}
    </div>
  );
}

/** "$47 call · 9 Oct (3d)" */
function contractName(contract: { strike?: number; expiry?: string; dte?: number }, right: "call" | "put"): string {
  return `$${contract.strike ?? "?"} ${right}${contract.expiry ? ` · ${formatDayMonth(contract.expiry)}` : ""}${contract.dte !== undefined ? ` (${contract.dte}d)` : ""}`;
}

function rightOf(kind: string): "call" | "put" {
  return kind.includes("covered_call") ? "call" : "put";
}

/** The figures shared by a candidate and a roll's replacement, as separate pieces so the line can wrap between them. */
function contractFigures(contract: PlutoModelInputContract): string[] {
  const quote = contract.bid !== undefined && contract.ask !== undefined ? `bid/ask ${contract.bid.toFixed(2)}/${contract.ask.toFixed(2)}${contract.spread_pct !== undefined ? `, spread ${contract.spread_pct.toFixed(1)}%` : ""}` : null;
  const liquidity = contract.oi !== undefined || contract.vol !== undefined ? [contract.oi !== undefined ? `OI ${formatNumber(contract.oi)}` : null, contract.vol !== undefined ? `vol ${formatNumber(contract.vol)}` : null].filter(Boolean).join(", ") : null;
  const staleQuote = contract.quote_source && contract.quote_source !== "live" ? `${contract.quote_source} quote${contract.quote_age_min !== undefined ? `, ${contract.quote_age_min} min old` : ""}` : null;
  return [
    contract.delta !== undefined ? `Δ ${Math.abs(contract.delta).toFixed(2)}` : null,
    quote,
    contract.ann_yield_pct !== undefined ? `${contract.ann_yield_pct}%/yr` : null,
    liquidity,
    staleQuote,
  ].filter((piece): piece is string => Boolean(piece));
}

function Pieces({ pieces }: { pieces: string[] }) {
  return (
    <>
      {pieces.map((piece, index) => (
        <span key={piece} className={index > 0 ? "pm-seen-piece" : undefined}>
          {piece}
        </span>
      ))}
    </>
  );
}

function Flags({ flags }: { flags: string[] | undefined }) {
  return (
    <>
      {(flags ?? []).map((flag) => (
        <span key={flag} className="pm-seen-flag">
          ⚑ {describeCandidateFlag(flag)}
        </span>
      ))}
    </>
  );
}

function CandidateLine({ candidate }: { candidate: PlutoModelInputContract }) {
  const edge = [
    candidate.edge_dollars !== undefined ? `edge ${formatCurrency(candidate.edge_dollars, 0)}` : null,
    candidate.net_edge_vp !== undefined ? `net ${candidate.net_edge_vp.toFixed(1)} vp${candidate.edge_vp !== undefined ? ` (${candidate.edge_vp.toFixed(1)} gross)` : ""}` : null,
  ].filter((piece): piece is string => Boolean(piece));
  return (
    <div className="pm-seen-line num">
      <StrategyBadge kind={candidate.kind as PlutoActionKind} contract={null} />
      <span className="what">{contractName(candidate, rightOf(candidate.kind))}</span>
      {candidate.grade && <GradeBadge grade={candidate.grade} />}
      <Pieces pieces={[...edge, ...contractFigures(candidate)]} />
      <Flags flags={candidate.flags} />
    </div>
  );
}

function RollLine({ roll }: { roll: PlutoModelInputRoll }) {
  const replacement = roll.replacement;
  const pieces = [
    roll.net_roll_edge_dollars !== undefined ? `net roll edge ${formatCurrency(roll.net_roll_edge_dollars, 0)}${roll.net_roll_edge_vp !== undefined ? ` (${roll.net_roll_edge_vp.toFixed(1)} vp)` : ""}` : null,
    roll.net_credit_per_share !== undefined ? `net credit ${roll.net_credit_per_share.toFixed(2)}/sh` : null,
    roll.delta_change !== undefined ? `Δ change ${formatSignedNumber(roll.delta_change)}` : null,
    ...contractFigures(replacement),
  ].filter((piece): piece is string => Boolean(piece));
  return (
    <div className="pm-seen-line num">
      <StrategyBadge kind="roll" contract={{ strategyKey: replacement.kind }} />
      <span className="what">
        {roll.quantity !== undefined ? `${roll.quantity}× ` : ""}roll → {contractName(replacement, rightOf(replacement.kind))}
      </span>
      {roll.grade && <GradeBadge grade={roll.grade} />}
      <Pieces pieces={pieces} />
      <Flags flags={[...(roll.flags ?? []), ...(replacement.flags ?? []).filter((flag) => !(roll.flags ?? []).includes(flag))]} />
    </div>
  );
}

function CloseOfferLine({ action }: { action: PlutoModelInputCloseAction }) {
  if (action.kind === "close_shares") {
    const pieces = [
      action.entry_price !== undefined ? `entry ${action.entry_price.toFixed(2)}` : null,
      action.cycle_pnl !== undefined ? `cycle P&L ${formatCurrency(action.cycle_pnl, 0)}${action.cycle_pnl_pct_of_capital !== undefined && action.cycle_pnl_pct_of_capital !== null ? ` (${action.cycle_pnl_pct_of_capital}% of capital)` : ""}` : null,
      action.odd_lot ? "odd lot" : null,
    ].filter((piece): piece is string => Boolean(piece));
    return (
      <div className="pm-seen-line num">
        <StrategyBadge kind="close_shares" contract={null} />
        <span className="pm-b warn">Sell shares</span>
        <span className="what">{action.shares !== undefined ? `${formatNumber(action.shares)} shares` : action.description}</span>
        <Pieces pieces={pieces} />
      </div>
    );
  }
  const contract = parseBuybackDescription(action.description);
  const pieces = [
    action.ask !== undefined ? `ask ${action.ask.toFixed(2)}${action.entry_credit !== undefined ? `, sold at ${action.entry_credit.toFixed(2)}` : ""}` : null,
    action.pnl_at_ask !== undefined ? `locks ${formatCurrency(action.pnl_at_ask, 0)} at the ask` : null,
    action.hold_edge_dollars !== undefined && action.close_cost_dollars !== undefined ? `hold edge ${formatCurrency(action.hold_edge_dollars, 0)} vs close cost ${formatCurrency(action.close_cost_dollars, 0)}` : null,
  ].filter((piece): piece is string => Boolean(piece));
  return (
    <div className="pm-seen-line num">
      {contract && <StrategyBadge kind="close_leg" contract={{ strategyKey: contract.right === "C" ? "covered_call" : "cash_secured_put" }} />}
      <span className="pm-b warn">Buy back</span>
      <span className="what">{contract ? `${contract.quantity}× ${contractName({ strike: Number(contract.strike), expiry: contract.expiry, dte: action.dte }, contract.right === "C" ? "call" : "put")}` : action.description}</span>
      <Pieces pieces={pieces} />
    </div>
  );
}

function AccountSection({ account }: { account: NonNullable<PlutoModelInput["account"]> }) {
  const pieces = [
    account.nlv !== undefined ? `NLV ${formatCurrency(account.nlv, 0)}` : null,
    account.free_cash !== undefined ? `free cash ${formatCurrency(account.free_cash, 0)}` : null,
    account.pluto_budget_pct !== undefined ? `Pluto budget ${account.pluto_budget_pct}% of NLV${account.pluto_budget_used_pct !== undefined ? `, ${account.pluto_budget_used_pct.toFixed(0)}% used` : ""}` : null,
    // Prompt v3.3 sends managed_positions (every position on an enabled ticker); older payloads only Pluto's own.
    account.managed_positions !== undefined && account.max_open_positions !== undefined ? `managed positions ${account.managed_positions} of ${account.max_open_positions}` : null,
    account.managed_positions === undefined && account.open_pluto_positions !== undefined && account.max_open_positions !== undefined ? `Pluto positions ${account.open_pluto_positions} of ${account.max_open_positions}` : null,
    account.actions_today !== undefined && account.max_actions_per_session !== undefined ? `actions today ${account.actions_today} of ${account.max_actions_per_session}` : null,
  ].filter((piece): piece is string => Boolean(piece));
  return (
    <div className="pm-seen-sect">
      <span className="pm-seen-l">Account</span>
      <div className="pm-seen-line num">
        <Pieces pieces={pieces} />
      </div>
    </div>
  );
}

function ParametersSection({ parameters }: { parameters: NonNullable<PlutoModelInput["parameters"]> }) {
  const pieces = [
    parameters.dte_range ? `DTE ${parameters.dte_range[0]}–${parameters.dte_range[1]}` : null,
    parameters.min_grade ? `min grade ${parameters.min_grade.charAt(0).toUpperCase()}${parameters.min_grade.slice(1)}` : null,
    parameters.max_abs_delta !== undefined ? `max |Δ| ${parameters.max_abs_delta.toFixed(2)}` : null,
    parameters.confidence_floor !== undefined ? `confidence floor ${parameters.confidence_floor.toFixed(2)}` : null,
    parameters.spread_cost_share_pct !== undefined ? `spread cost ${parameters.spread_cost_share_pct}% of the half-spread` : null,
    parameters.max_ticker_exposure_pct !== undefined ? `max ${parameters.max_ticker_exposure_pct}% of NLV per ticker` : null,
    parameters.order_size_pct_of_budget !== undefined ? `order size ${parameters.order_size_pct_of_budget}% of budget` : null,
  ].filter((piece): piece is string => Boolean(piece));
  return (
    <div className="pm-seen-sect">
      <span className="pm-seen-l">Parameters</span>
      <div className="pm-seen-line num">
        <Pieces pieces={pieces} />
      </div>
    </div>
  );
}

function RecentDecisionsSection({ decisions }: { decisions: NonNullable<PlutoModelInput["recent_decisions"]> }) {
  return (
    <div className="pm-seen-sect">
      <span className="pm-seen-l">Recent decisions ({decisions.length})</span>
      <div className="pm-seen-decisions">
        {decisions.map((decision) => {
          const outcome = decision.outcome ? describeTradeOutcome(decision.outcome) : null;
          return (
            <div key={`${decision.at}-${decision.verdict}`}>
              <span className="t num">{formatBrowserClockTimeWithSeconds(decision.at)}</span>
              <span className="v">
                {describeRecentDecisionVerdict(decision.verdict)}
                {decision.verdict === "trade" && decision.candidate_id ? ` · ${describeCandidateId(decision.candidate_id)}` : ""}
                {outcome && <span className={`pm-b ${outcome.tone}`}>{outcome.label}</span>}
              </span>
              <span className="r">
                {decision.reason ?? "—"}
                {decision.outcome_detail && <span className="muted"> {outcome?.label}: {decision.outcome_detail}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
