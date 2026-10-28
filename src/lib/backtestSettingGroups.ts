import type { BacktestSettingCondition, BacktestSettingGroup, BacktestSettingRow, BacktestSettingSection } from "../api/backtest";
import type { BacktestLabTickerField, BacktestLabTickerOverrides } from "../api/backtestAnalysis";
import { decisionMakerLabel } from "./backtestPresentation";

// The settings' groups as the API's template lays them out (settingsTemplate.ts backtestSettingLayout), for the lab's
// settings editor and the New session table: which rows apply with the values being edited, rows shown as a pair, and
// each group's one-line summary while it is closed.

export const backtestSettingSectionTitles: Record<BacktestSettingSection, string> = {
  baseline_wheel: "Used by the CC + Put Ladder",
  steady_stake: "Used by the Steady Stake",
  vol_farmer: "Used by the Vol Farmer",
  vol_farmer_v2: "Used by Vol Farmer v2",
};

export const steadyStakeSectionNote = "Used only when the decision maker is the Steady Stake. None of these change a CC + Put Ladder session; the ladder's values don't change a Steady Stake session.";

export const volFarmerSectionNote = "Used only when the decision maker is the Vol Farmer. None of these change a CC + Put Ladder or Steady Stake session.";

export const volFarmerV2SectionNote = "Used only when the decision maker is Vol Farmer v2, with the Vol Farmer's Calls' |delta| range and spread limit. None of these change any other session.";

/** The note under a section's title; the CC + Put Ladder's section opens the table and has none. */
export const backtestSettingSectionNotes: Record<BacktestSettingSection, string | null> = { baseline_wheel: null, steady_stake: steadyStakeSectionNote, vol_farmer: volFarmerSectionNote, vol_farmer_v2: volFarmerV2SectionNote };

export interface BacktestSettingRowGroup {
  group: BacktestSettingGroup;
  section: BacktestSettingSection;
  rows: BacktestSettingRow[];
}

/** The rows by group, in the template's order. */
export function groupBacktestSettingRows(rows: BacktestSettingRow[]): BacktestSettingRowGroup[] {
  const groups: BacktestSettingRowGroup[] = [];
  for (const row of rows) {
    const existing = groups.find((entry) => entry.group === row.group);
    if (existing) existing.rows.push(row);
    else groups.push({ group: row.group, section: row.section, rows: [row] });
  }
  return groups;
}

function conditionHolds(condition: BacktestSettingCondition, valueOf: (path: string) => string | undefined): boolean {
  const value = valueOf(condition.path);
  if (value === undefined) return true;
  if (condition.oneOf && !condition.oneOf.includes(value)) return false;
  if (condition.noneOf && condition.noneOf.includes(value)) return false;
  if (condition.above !== undefined && !(Number(value) > condition.above)) return false;
  return true;
}

/** Whether the row's value is read with these values; a row without a condition always is. */
export function settingAppliesNow(row: BacktestSettingRow, valueOf: (path: string) => string | undefined): boolean {
  const { appliesWhen } = row;
  if (!appliesWhen) return true;
  const all = (appliesWhen.allOf ?? []).every((condition) => conditionHolds(condition, valueOf));
  const any = !appliesWhen.anyOf || appliesWhen.anyOf.some((condition) => conditionHolds(condition, valueOf));
  return all && any;
}

/** Two rows the lab's editor shows on one line, keyed by the first: the second's path and the pair's label. */
const pairedSettingRows: Record<string, { secondPath: string; label: string }> = {
  "pluto.windowStartEt": { secondPath: "pluto.windowEndEt", label: "Looks from / until" },
  "baseline.ladderShockMinPct": { secondPath: "baseline.ladderShockMaxPct", label: "Shock from history: at least / at most" },
  "baseline.callMinAbsDelta": { secondPath: "baseline.callMaxAbsDelta", label: "Calls' |delta| from / to" },
  "baseline.minAbsDelta": { secondPath: "baseline.maxAbsDelta", label: "|delta| from / to" },
  "baseline.minDte": { secondPath: "baseline.maxDte", label: "Days to expiry from / to" },
  "trading.deltaTargetMin": { secondPath: "trading.deltaTargetMax", label: "Delta band from / to" },
  "pluto.minDte": { secondPath: "pluto.maxDte", label: "Days to expiry from / to" },
  "volFarmer.callMinAbsDelta": { secondPath: "volFarmer.callMaxAbsDelta", label: "Calls' |delta| from / to" },
  "volFarmer.callMinDte": { secondPath: "volFarmer.callMaxDte", label: "Calls' days to expiry from / to" },
  "volFarmer.putMinDte": { secondPath: "volFarmer.putMaxDte", label: "Puts' days to expiry from / to" },
};

/** A line of the editor: one row, or a pair under one label. */
export interface BacktestSettingLine {
  label: string;
  rows: BacktestSettingRow[];
}

/** Inside the Put ladder card its rows drop the "Ladder: " their labels carry elsewhere ("Ladder: rungs" reads "Rungs"). */
function lineLabel(row: BacktestSettingRow): string {
  if (row.group !== "Put ladder" || !row.label.startsWith("Ladder: ")) return row.label;
  const rest = row.label.slice("Ladder: ".length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function backtestSettingLines(rows: BacktestSettingRow[]): BacktestSettingLine[] {
  const lines: BacktestSettingLine[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const pair = pairedSettingRows[row.path];
    const next = rows[index + 1];
    if (pair && next?.path === pair.secondPath) {
      lines.push({ label: pair.label, rows: [row, next] });
      index++;
    } else lines.push({ label: lineLabel(row), rows: [row] });
  }
  return lines;
}

const callStrikeSummaries: Record<string, string> = {
  delta_range: "any strike in the range",
  above_share_cost: "strike ≥ the shares' cost",
  above_break_even: "strike ≥ break-even",
  above_latest_entry: "strike ≥ the latest purchase",
  above_average_cost: "strike ≥ the average price",
};

/**
 * A closed group's one-line summary. `text` is a row's value as typed; `shown` is how its row prints it (a choice's label,
 * a percent with its sign).
 */
/** The Hedge group's fewer-purchases rule, when one is on: "kept 30 days for the next entry". */
const fewerPurchasesSummary: Record<string, (text: (path: string) => string, shown: (path: string) => string) => string[]> = {
  keep_for_next_entry: (text) => [`kept ${text("baseline.hedgePutTurnoverDays")} days for the next entry`],
  keep_unless_far_below: (text, shown) => [`kept ${text("baseline.hedgePutTurnoverDays")} days unless ${shown("baseline.hedgePutFarBelowPct")} below`],
  wait_between_purchases: (text) => [`${text("baseline.hedgePutTurnoverDays")} days between purchases`],
};

export function backtestSettingGroupSummary(group: BacktestSettingGroup, text: (path: string) => string, shown: (path: string) => string): string {
  switch (group) {
    case "How the session runs":
      return [decisionMakerLabel[text("decisionMaker") as keyof typeof decisionMakerLabel] ?? shown("decisionMaker"), text("baseline.looks") === "every_look" ? "every look" : "once a day", ({ covered_call: "Covered Call entry", higher_yield: "put or Covered Call entry, whichever ranks higher" } as Record<string, string>)[text("baseline.entry")] ?? "Cash-Secured Put entry"].join(" · ");
    case "Put ladder": {
      const puts = text("baseline.putsWhenNoCall");
      if (puts === "off") return "no ladder";
      const shock = text("baseline.ladderShock") === "history" ? `shock from history ${text("baseline.ladderShockMinPct")}–${shown("baseline.ladderShockMaxPct")}` : `fixed shock ${shown("baseline.ladderShockPct")}`;
      return `${text("baseline.ladderRungs")} rungs · shares ≤ ${shown("baseline.ladderSharesPct")} · ${shock}`;
    }
    case "Calls and Covered Calls":
      return [
        callStrikeSummaries[text("baseline.callStrike")] ?? shown("baseline.callStrike"),
        text("baseline.callDeltaRange") === "entry_range" ? "same |delta| as the Puts" : `|delta| ${text("baseline.callMinAbsDelta")}–${text("baseline.callMaxAbsDelta")}`,
        Number(text("baseline.minCallYieldPct")) > 0 ? `min yield ${shown("baseline.minCallYieldPct")}` : "any yield",
      ].join(" · ");
    case "Contract choice":
      return `|delta| ${text("baseline.minAbsDelta")}–${text("baseline.maxAbsDelta")} · ${text("baseline.minDte")}–${text("baseline.maxDte")} DTE · spread ≤ ${shown("baseline.maxSpreadPctOfMid")} · by ${shown("baseline.ranking").toLowerCase()}`;
    case "Entry filters": {
      const filters = [text("baseline.entryExtensionFilter") === "on" ? `extension z ≥ ${text("baseline.entryMaxExtensionZ")}` : null, text("baseline.entryIvRankFilter") === "on" ? `IV Rank ≥ ${text("baseline.entryMaxIvRank")}` : null].filter((filter) => filter !== null);
      return filters.length === 0 ? "off" : `no new entry at ${filters.join(" or ")}`;
    }
    case "Exits":
      return [Number(text("baseline.takeProfitPct")) > 0 ? `take profit at ${shown("baseline.takeProfitPct")}` : "hold to expiry", Number(text("baseline.shareStopLossPct")) > 0 ? `share stop ${shown("baseline.shareStopLossPct")}` : "no share stop"].join(" · ");
    case "Hedge": {
      if (!(Number(text("baseline.hedgePutTenorDays")) > 0)) return "no hedge";
      const byDelta = text("baseline.hedgePutStrikeBy") === "delta";
      const strike = byDelta ? `|delta| ${text("baseline.hedgePutAbsDelta")}` : Number(text("baseline.hedgePutBelowPricePct")) > 0 ? `${shown("baseline.hedgePutBelowPricePct")} below` : "at the money";
      const share = Number(text("baseline.hedgePutCoveragePct")) < 100 ? ` × ${shown("baseline.hedgePutCoveragePct")}` : "";
      const gate = (
        {
          cost_vs_typical_fall: [`none while the yearly cost is above ${text("baseline.hedgePutCostFallShare")} × the typical yearly fall`],
          iv_vs_history: [`none while IV is above ${text("baseline.hedgePutIvMultiple")} × the median IV`],
          iv_vs_realized: [`none while IV is above ${text("baseline.hedgePutIvMultiple")} × realized volatility`],
        } as Record<string, string[]>
      )[text("baseline.hedgePutPriceGate")] ?? [];
      if (text("baseline.hedgePutCovers") === "position")
        return [
          `Puts ${text("baseline.hedgePutTenorDays")} days (${text("baseline.hedgePutExpiry") === "nearest" ? "nearest" : "first at or after"}) over ${text("baseline.hedgePutStaggeredExpiries")} expiries`,
          byDelta ? strike : `${strike} from the stock price`,
          ...gate,
          `the whole position${share}`,
          `rolled at ${text("baseline.hedgePutRollDaysLeft")} days left`,
          text("baseline.hedgeInBreakEven") === "included" ? "P&L in the break-even" : "P&L out of the break-even",
        ].join(" · ");
      return [
        `Puts ${text("baseline.hedgePutTenorDays")} days (${text("baseline.hedgePutExpiry") === "nearest" ? "nearest" : "first at or after"})`,
        byDelta ? strike : `${strike} from ${text("baseline.hedgePutStrikeFrom") === "price_paid" ? "the price paid" : "the stock price"}`,
        ...gate,
        `${text("baseline.hedgePutSize") === "rung_level" ? "rung level" : "share level"}${share}`,
        text("baseline.hedgeInBreakEven") === "included" ? "P&L in the break-even" : "P&L out of the break-even",
        ...(fewerPurchasesSummary[text("baseline.hedgePutTurnover")]?.(text, shown) ?? []),
      ].join(" · ");
    }
    case "Steady Stake":
      return [
        `stake ${shown("steadyStake.stakePct")} ± ${text("steadyStake.rebalanceBandPct")}`,
        Number(text("steadyStake.callCoveragePct")) > 0 ? `Calls on ${shown("steadyStake.callCoveragePct")} of free lots at ${text("steadyStake.callAbsDelta")}` : "no Calls",
        Number(text("steadyStake.putCashPct")) > 0 ? `Puts on ${shown("steadyStake.putCashPct")} of free cash at ${text("steadyStake.putAbsDelta")}` : "no Puts",
        "expiry days only",
      ].join(" · ");
    case "Vol Farmer":
      return [
        `Calls |delta| ${text("volFarmer.callMinAbsDelta")}–${text("volFarmer.callMaxAbsDelta")}, ${text("volFarmer.callExpiry") === "next" ? "next expiry" : `${text("volFarmer.callMinDte")}–${text("volFarmer.callMaxDte")} DTE`}`,
        // A session run without a hedge (research) reads none of the Put settings.
        ...(text("volFarmer.hedge") === "none"
          ? ["no hedge"]
          : [
              `Puts ${Number(text("volFarmer.putMinDte")) > 0 ? `${text("volFarmer.putMinDte")}–${text("volFarmer.putMaxDte")} DTE` : `to ${text("volFarmer.putMaxDte")} DTE`}, strike ${Number(text("volFarmer.putMaxStrikeAbovePricePct")) > 0 ? `up to ${shown("volFarmer.putMaxStrikeAbovePricePct")} above the price` : Number(text("volFarmer.putMaxStrikeAbovePricePct")) < 0 ? `at least ${Math.abs(Number(text("volFarmer.putMaxStrikeAbovePricePct")))}% below the price` : "at or below the price"}`,
              `protection on a ${shown("volFarmer.protectionFallPct")} fall`,
            ]),
        `${shown("volFarmer.putCashReservePct")} cash kept`,
      ].join(" · ");
    case "Vol Farmer v2":
      return [
        `Puts start under ${shown("volFarmerV2.putsStartCallYieldPct")}`,
        `Put |delta| ${text("volFarmerV2.putMaxAbsDelta")}, Step ${text("volFarmerV2.stepRule") === "implied_move_at_put_sale" ? "the one-month implied move at each Put sale" : shown("volFarmerV2.stepBelowFirstBreakEvenPct")} below the first break-even`,
        `LEAPS ${text("volFarmerV2.leapsMinDte")}+ days at |delta| ${text("volFarmerV2.leapsAbsDelta")}${Number(text("volFarmerV2.leapsMaxAccountPct")) > 0 ? `, at most ${shown("volFarmerV2.leapsMaxAccountPct")} of the account` : ""}`,
        text("volFarmerV2.looks") === "every_look" ? "decides at every look" : "decides at 10:00",
      ].join(" · ");
  }
}

/** The lab values each ticker override stands in for (labSettingsStore.ts globalPathsByTickerField): a fixed shock replaces the whole shock rule. */
const labPathsByTickerField: Record<BacktestLabTickerField, readonly string[]> = {
  potDollars: ["lab.defaultPotDollars"],
  ladderSharesPct: ["baseline.ladderSharesPct"],
  ladderRungs: ["baseline.ladderRungs"],
  ladderShockPct: ["baseline.ladderShock", "baseline.ladderShockPct", "baseline.ladderShockMinPct", "baseline.ladderShockMaxPct", "baseline.ladderShockNoHistoryPct", "baseline.ladderShockLookbackYears"],
  minAbsDelta: ["baseline.minAbsDelta"],
  maxAbsDelta: ["baseline.maxAbsDelta"],
};

/** The tickers whose own value replaces this lab value. */
export function labTickersKeepingTheirOwn(path: string, overrides: readonly BacktestLabTickerOverrides[]): string[] {
  const fields = (Object.keys(labPathsByTickerField) as BacktestLabTickerField[]).filter((field) => labPathsByTickerField[field].includes(path));
  return overrides.filter((row) => fields.some((field) => row[field] !== null)).map((row) => row.symbol);
}

const settingPathPattern = /\b(?:baseline|pluto|trading|policy|model|lab|fixed)\.[A-Za-z]+\b|\bkellyFraction\b|\bdecisionMaker\b/g;
const labOnlyLabels: Record<string, string> = { "lab.defaultPotDollars": "Default pot" };

/** A refusal from the API with each setting key ("baseline.putsWhenNoCall") written as its label ("Puts when no call is sold"). */
export function labelSettingPaths(message: string, rows: readonly BacktestSettingRow[]): string {
  const labelByPath = new Map(rows.map((row) => [row.path, row.label]));
  return message.replace(settingPathPattern, (path) => labelByPath.get(path) ?? labOnlyLabels[path] ?? path);
}

/** The setting keys a refusal names, first mention first. */
export function settingPathsInMessage(message: string): string[] {
  return [...new Set(message.match(settingPathPattern) ?? [])];
}
