import { IconLock } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FrozenTicker } from "../../api/environment";
import { FrozenTickerBadge } from "../FrozenTickerBadge";
import { useFrozenTickers } from "../../hooks/useFrozenTickers";
import { useIsAdmin } from "../../hooks/useAuth";
import { ApiError } from "../../api/client";
import { fetchPlutoLadderSettings, fetchPlutoVolFarmerV2, updateShortlistBotEnabled, type PlutoLadderTickerSettings, type PlutoSettings, type PlutoState, type PlutoVolFarmerV2Ticker } from "../../api/pluto";
import type { ShortlistRow, TickerBackfillRun } from "../../api/shortlist";
import { formatBrowserDayMonth, formatCurrency, formatInputNumber, pluralize } from "../../lib/formatters";
import { effectiveAllocationPct, ladderFit, recommendedShockAt } from "../../lib/plutoLadderPresentation";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { DailyBarsCell, EarningsCell, ImpliedVolatilityDaysCell, OptionChainExpiriesCell, PreparingStatusBadge } from "../shortlist/readinessCells";
import { TickerPrepModal } from "../shortlist/TickerPrepModal";
import { Meter, SearchIcon, TickerButton, ToneBadge } from "./plutoBits";
import { PlutoStopsManagingConfirm, plutoStopsManagingPositions } from "./PlutoStopsManagingConfirm";
import { PlutoLadderTickerWindow } from "./PlutoLadderTickerWindow";
import { PlutoTickerStrategySelect } from "./PlutoTickerStrategySelect";

interface PlutoTickersTabProps {
  rows: ShortlistRow[];
  loading: boolean;
  error: string | null;
  state: PlutoState | null;
  maxEnabled: number;
  isPhone: boolean;
  onOpenTicker: (symbol: string) => void;
  onToggled: (entryId: string, enabled: boolean) => void;
  onPrepRunChange: (run: TickerBackfillRun | null) => void;
  /** Pluto's settings: the ladder's strategy values the window shows beside each ticker's own. */
  settings: PlutoSettings | null;
  /** The window's "Edit the strategy values" link. */
  onOpenSettingsTab: () => void;
}

type Filter = "all" | "on" | "off";

const columns = [
  { key: "switch", header: "Pluto may trade" },
  { key: "ticker", header: "Ticker" },
  { key: "strategy", header: "Strategy", title: "The strategy Pluto runs on the ticker: Vol Farmer v2 unless set to the CC + Put Ladder" },
  { key: "sector", header: "Sector" },
  { key: "now", header: "Pluto now" },
  { key: "allocation", header: "Allocation", title: "% of Pluto's capital budget: set, or an equal share of what the set allocations leave", align: "right" },
  { key: "pot", header: "Pot", title: "The allocation of Pluto's capital budget at last night's account value", align: "right" },
  { key: "ladder", header: "Ladder", title: "The CC + Put Ladder values this ticker overrides" },
  { key: "checks", header: "Checks", title: "A CC + Put Ladder ticker: whether a lot and a ladder Put fit the pot at the last close" },
  { key: "dailyBars", header: "Daily bars", title: "Daily price history", align: "right" },
  { key: "ivDays", header: "IV days", title: "Days of implied-volatility history in IV Rank and IV %ile's 252-day window", align: "right" },
  { key: "earnings", header: "Earnings", title: "Earnings dates on record, with the next one", align: "right" },
  { key: "expiries", header: "Chain expiries", title: "Expiries with strikes stored", align: "right" },
  { key: "status", header: "Status" },
  { key: "settings", header: "Settings" },
] as const;

const percentText = (value: number) => `${formatInputNumber(+value.toFixed(2), 2)}%`;

/** "6 rungs · |delta| ≤ 0.25": what a ticker overrides; empty when nothing. */
function describeLadderOverrides(ticker: PlutoLadderTickerSettings): string[] {
  const parts: string[] = [];
  if (ticker.tickerOverrides.ladderSharesPct !== null) parts.push(`${percentText(ticker.tickerOverrides.ladderSharesPct)} shares`);
  if (ticker.overrideShockPct !== null) parts.push(`shock ${percentText(ticker.overrideShockPct)}`);
  if (ticker.tickerOverrides.ladderRungs !== null) parts.push(`${ticker.tickerOverrides.ladderRungs} rungs`);
  const { minAbsDelta, maxAbsDelta } = ticker.tickerOverrides;
  if (minAbsDelta !== null && maxAbsDelta !== null) parts.push(`|delta| ${minAbsDelta.toFixed(2)}–${maxAbsDelta.toFixed(2)}`);
  else if (minAbsDelta !== null) parts.push(`|delta| ≥ ${minAbsDelta.toFixed(2)}`);
  else if (maxAbsDelta !== null) parts.push(`|delta| ≤ ${maxAbsDelta.toFixed(2)}`);
  return parts;
}

/** A ticker's checks at its saved values and its pot; null when there is nothing to check (no pot, no close, no shock). */
function savedTickerFit(ticker: PlutoLadderTickerSettings, settings: PlutoSettings | null): { fits: boolean; reason: string | null } | null {
  if (!settings || ticker.potDollars === null || ticker.lastClose === null) return null;
  const shockPct = ticker.overrideShockPct ?? ticker.recommendedShockPct ?? recommendedShockAt(ticker.recommendedShockSource, { minPct: settings.ladderShockMinPct, maxPct: settings.ladderShockMaxPct, noHistoryPct: settings.ladderShockNoHistoryPct });
  if (shockPct === null) return null;
  const fit = ladderFit({ price: ticker.lastClose.price, pot: ticker.potDollars, sharesPct: ticker.baseline.ladderSharesPct, rungs: ticker.baseline.ladderRungs, shockPct });
  return { fits: fit.lotFits && fit.putFits, reason: !fit.lotFits ? "The shares don't buy a lot" : !fit.putFits ? "A Put doesn't fit a rung" : null };
}

function ChecksBadge({ check }: { check: { fits: boolean; reason: string | null } | null }) {
  if (!check) return <span className="muted">—</span>;
  return (
    <>
      <span className={`pm-b ${check.fits ? "ok" : "bad"}`}>{check.fits ? "Fits" : "Doesn't fit"}</span>
      {check.reason && <span className="pm-cell-sub">{check.reason}</span>}
    </>
  );
}

/** The per-ticker switch in the mockup's own style; saves on click, the cap error comes back from the API. Locked for a
 *  trader: only an admin may switch Pluto on or off for a ticker (the API refuses a trader too). */
function TickerSwitch({ row, onToggled, onError, withLabel, locked }: { row: ShortlistRow; onToggled: (enabled: boolean) => void; onError: (message: string) => void; withLabel: boolean; locked: boolean }) {
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  function requestToggle() {
    if (saving || locked) return;
    if (plutoStopsManagingPositions(row.botEnabled, row.openPositionCount)) setConfirming(true);
    else void toggle();
  }
  async function toggle() {
    setConfirming(false);
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateShortlistBotEnabled(row.id, !row.botEnabled);
      onToggled(result.botEnabled);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : `Could not update Pluto for ${row.symbol}.`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <label className={`pm-switch${locked ? " locked" : ""}`} title={locked ? "Only an admin can switch Pluto on or off for a ticker." : undefined}>
        <input type="checkbox" role="switch" checked={row.botEnabled} disabled={saving || locked} onChange={requestToggle} aria-label={`Pluto may trade ${row.symbol}`} />
        {locked && <IconLock size={12} aria-hidden="true" className="text-secondary flex-shrink-0" />}
        {withLabel && <span className={`pm-switch-state ${row.botEnabled ? "on" : "off"}`}>{saving ? <Spinner size="sm" /> : row.botEnabled ? "Allowed" : "Off"}</span>}
      </label>
      {confirming && <PlutoStopsManagingConfirm symbol={row.symbol} openPositionCount={row.openPositionCount} onConfirm={() => void toggle()} onCancel={() => setConfirming(false)} />}
    </>
  );
}

/** What Pluto does with the ticker now; a frozen ticker (a stock split until its records are rewritten) is skipped. */
function plutoNowOrFrozen(row: ShortlistRow, state: PlutoState | null, volFarmerV2: PlutoVolFarmerV2Ticker | undefined, frozen: FrozenTicker | undefined, compact = false): { tone: "neutral" | "info" | "bad"; label: string; title?: string } | null {
  // The phone list's status column is narrow: the short form there, the split itself is in the Frozen badge's tooltip.
  if (frozen) return { tone: "bad", label: compact ? "Skipped: frozen" : `Skipped: frozen after a ${frozen.reason.replace(/ effective .*$/, "")}` };
  return plutoNow(row, state, volFarmerV2);
}

function plutoNow(row: ShortlistRow, state: PlutoState | null, volFarmerV2: PlutoVolFarmerV2Ticker | undefined): { tone: "neutral" | "info"; label: string; title?: string } | null {
  const working = state?.book.workingOrdersBySymbol[row.symbol] ?? 0;
  const open = state?.book.openPositionsBySymbol[row.symbol] ?? 0;
  const book = working > 0 ? { tone: "info" as const, label: pluralize(working, "working order") } : open > 0 ? { tone: "neutral" as const, label: pluralize(open, "open position") } : null;
  // A Vol Farmer v2 ticker: whether v2 adopted its holdings, or waits to (the last round says why).
  if (volFarmerV2?.waiting && volFarmerV2.lastRoundNotes.length > 0) {
    const why = volFarmerV2.lastRoundNotes[0]!;
    return { tone: "neutral", label: why.startsWith("holds no shares yet") ? "v2 waits: Puts only" : "v2 waits", title: why };
  }
  if (volFarmerV2?.adoptedAt && book) return { ...book, label: `v2 adopted · ${book.label}` };
  return book;
}

function changedBy(row: ShortlistRow): string | null {
  if (!row.botEnabledChangedAt) return null;
  return `${row.botEnabledChangedBy ?? "—"} · ${formatBrowserDayMonth(row.botEnabledChangedAt)}`;
}

export function PlutoTickersTab({ rows, loading, error, state, maxEnabled, isPhone, onOpenTicker, onToggled, onPrepRunChange, settings, onOpenSettingsTab }: PlutoTickersTabProps) {
  const frozenTickers = useFrozenTickers();
  const isAdmin = useIsAdmin();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [prepTicker, setPrepTicker] = useState<{ tickerId: string; symbol: string; companyName: string | null } | null>(null);
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-tickers", columns.map((column) => column.key));
  const [ladderTickers, setLadderTickers] = useState<PlutoLadderTickerSettings[] | null>(null);
  const [ladderError, setLadderError] = useState<string | null>(null);
  const [volFarmerV2Tickers, setVolFarmerV2Tickers] = useState<PlutoVolFarmerV2Ticker[]>([]);
  const [settingsSymbol, setSettingsSymbol] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // The ladder's per-ticker values; again whenever a ticker is switched on or off (its pot and the equal share change).
  const enabledKey = rows.filter((row) => row.botEnabled).map((row) => row.symbol).join(",");
  const loadLadder = useCallback(async () => {
    try {
      setLadderTickers(await fetchPlutoLadderSettings());
      setLadderError(null);
    } catch {
      setLadderError("Could not load the tickers' ladder settings.");
    }
    // What v2 holds on its tickers is an extra for the Pluto now column: the tab works without it.
    fetchPlutoVolFarmerV2().then(setVolFarmerV2Tickers, () => setVolFarmerV2Tickers([]));
  }, []);
  useEffect(() => {
    void loadLadder();
  }, [loadLadder, enabledKey]);
  const ladderBySymbol = useMemo(() => new Map((ladderTickers ?? []).map((ticker) => [ticker.symbol, ticker])), [ladderTickers]);
  const volFarmerV2BySymbol = useMemo(() => new Map(volFarmerV2Tickers.map((ticker) => [ticker.symbol, ticker])), [volFarmerV2Tickers]);
  const allocations = useMemo(() => effectiveAllocationPct(rows.filter((row) => row.botEnabled).map((row) => ({ symbol: row.symbol, setPct: ladderBySymbol.get(row.symbol)?.allocationPct ?? null }))), [rows, ladderBySymbol]);

  const enabledCount = rows.filter((row) => row.botEnabled).length;
  const needle = search.trim().toUpperCase();
  const visibleRows = useMemo(
    () => rows.filter((row) => (filter === "all" || (filter === "on") === row.botEnabled) && (!needle || row.symbol.toUpperCase().includes(needle) || (row.companyName ?? "").toUpperCase().includes(needle))),
    [rows, filter, needle],
  );
  const visibleColumns = columns.filter((column) => isColumnVisible(column.key));

  const toolbar = (
    <div className="pm-toolbar">
      <div className="pm-seg" role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          All <span className="cnt">{rows.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={filter === "on"} className={filter === "on" ? "on" : ""} onClick={() => setFilter("on")}>
          Allowed <span className="cnt">{enabledCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={filter === "off"} className={filter === "off" ? "on" : ""} onClick={() => setFilter("off")}>
          Off <span className="cnt">{rows.length - enabledCount}</span>
        </button>
      </div>
      <label className="pm-search">
        <SearchIcon />
        <input type="text" placeholder="Search ticker or company" aria-label="Search tickers" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <span className="pm-spacer" />
      <span className="pm-note">Each allowed ticker uses one IBKR market-data line</span>
      {!isPhone && <ColumnVisibilityPopover variant="toolbar" columns={columns.map((column) => ({ key: column.key, header: column.header }))} isColumnVisible={isColumnVisible} onToggleColumn={toggleColumn} />}
    </div>
  );

  const budget = ladderTickers?.find((ticker) => ticker.capitalBudgetDollars !== null)?.capitalBudgetDollars ?? null;
  const enabledRows = rows.filter((row) => row.botEnabled);
  const setRows = enabledRows.filter((row) => ladderBySymbol.get(row.symbol)?.allocationPct != null);
  const equalRows = enabledRows.filter((row) => ladderBySymbol.get(row.symbol)?.allocationPct == null);
  const setTotal = setRows.reduce((sum, row) => sum + (ladderBySymbol.get(row.symbol)!.allocationPct ?? 0), 0);
  const equalShare = equalRows.length === 0 ? null : Math.max(0, (100 - setTotal) / equalRows.length);
  const allocationStrip = ladderTickers && enabledRows.length > 0 && (
    <div className="pm-alloc">
      <span>
        Pluto's budget <b>{budget === null ? "—" : formatCurrency(budget, 0)}</b>
        {budget !== null && settings && <span className="muted"> ({percentText(settings.capitalBudgetPct)} of last night's {formatCurrency((budget * 100) / settings.capitalBudgetPct, 0)})</span>}
      </span>
      <span className="pm-alloc-bar" aria-hidden="true">
        {setRows.map((row) => (
          <span key={row.symbol} className="set" style={{ width: `${ladderBySymbol.get(row.symbol)!.allocationPct}%` }} />
        ))}
        {equalShare !== null && equalRows.map((row) => <span key={row.symbol} className="eq" style={{ width: `${equalShare}%` }} />)}
      </span>
      <span>
        Set <b>{percentText(setTotal)}</b>
        {setRows.length > 0 && <span className="muted"> ({setRows.map((row) => `${row.symbol} ${percentText(ladderBySymbol.get(row.symbol)!.allocationPct!)}`).join(", ")})</span>}
      </span>
      {equalShare !== null && (
        <span>
          Equal share <b>{percentText(equalShare)}</b> each for {equalRows.map((row) => row.symbol).join(", ")}
        </span>
      )}
    </div>
  );
  const ladderCells = (row: ShortlistRow) => {
    const ladder = ladderBySymbol.get(row.symbol);
    const allocation = row.botEnabled ? allocations.get(row.symbol) ?? null : null;
    const overrides = ladder ? describeLadderOverrides(ladder) : [];
    return {
      allocation:
        allocation === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <b className="strong num">{percentText(allocation)}</b>
            <span className="pm-cell-sub">{ladder?.allocationPct != null ? "set" : "equal share"}</span>
          </>
        ),
      pot: !row.botEnabled ? <span className="muted">Not enabled</span> : ladder?.potDollars != null ? formatCurrency(ladder.potDollars, 0) : <span className="muted">—</span>,
      ladder:
        overrides.length === 0 ? (
          <span className="muted">Strategy values</span>
        ) : (
          <>
            <span className="pm-b info">{pluralize(overrides.length, "override")}</span>
            <span className="pm-cell-sub">{overrides.join(" · ")}</span>
          </>
        ),
      strategy: ladder ? (
        <PlutoTickerStrategySelect
          symbol={row.symbol}
          strategy={ladder.effectiveStrategy}
          enabled={row.botEnabled}
          firstBreakEven={volFarmerV2BySymbol.get(row.symbol)?.first?.breakEvenPerShare ?? null}
          locked={!isAdmin}
          onSaved={(strategy) => {
            setSavedNote(`${row.symbol} runs ${strategy === "vol_farmer_v2" ? "Vol Farmer v2" : "the CC + Put Ladder"} from Pluto's next round.`);
            void loadLadder();
          }}
          onError={setToggleError}
        />
      ) : (
        <span className="muted">—</span>
      ),
      checks: row.botEnabled && ladder?.effectiveStrategy === "cc_put_ladder" ? <ChecksBadge check={savedTickerFit(ladder, settings)} /> : <span className="muted">—</span>,
      settings: (
        <button type="button" className="pm-btn sm pm-tk-settings" onClick={() => setSettingsSymbol(row.symbol)} disabled={!ladder || !settings}>
          Settings
        </button>
      ),
    };
  };

  let body: React.ReactNode;
  if (error) body = <div className="alert alert-danger pm-error mb-0">{error}</div>;
  else if (loading) body = <div className="pm-empty"><Spinner size="sm" label="Loading tickers" /></div>;
  else if (visibleRows.length === 0) body = <div className="pm-empty">{rows.length === 0 ? "No tickers yet — add one on the Shortlist first." : "No tickers match."}</div>;
  else if (isPhone) {
    body = (
      <ul className="pm-mlist">
        {visibleRows.map((row) => {
          const now = plutoNowOrFrozen(row, state, volFarmerV2BySymbol.get(row.symbol), frozenTickers.get(row.symbol), true);
          return (
            <li key={row.id} className={`pm-m-tk${row.botEnabled ? " on" : ""}${isAdmin ? "" : " locked"}`}>
              <TickerSwitch row={row} withLabel={false} locked={!isAdmin} onToggled={(enabled) => onToggled(row.id, enabled)} onError={setToggleError} />
              <span className="pm-tk-name">
                <span>
                  <TickerButton symbol={row.symbol} onOpen={onOpenTicker} />
                  <FrozenTickerBadge frozen={frozenTickers.get(row.symbol)} />
                </span>
                <span className="co">{row.companyName ?? "—"}</span>
              </span>
              <span className="right">
                <span className={`pm-switch-state ${row.botEnabled ? "on" : "off"}`}>{row.botEnabled ? "Allowed" : "Off"}</span>
                {now && <ToneBadge tone={now.tone} title={now.title}>{now.label}</ToneBadge>}
              </span>
              {(() => {
                const cells = ladderCells(row);
                return (
                  <span className="pm-m-ladder">
                    {row.botEnabled && (
                      <>
                        <span className="pm-m-ladder-fig">{cells.allocation}</span>
                        <span className="pm-m-ladder-fig num">{cells.pot}</span>
                        <span className="pm-m-ladder-fig">{cells.checks}</span>
                      </>
                    )}
                    <span className="pm-m-ladder-fig">{cells.strategy}</span>
                    {cells.settings}
                  </span>
                );
              })()}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="pm-table-wrap">
        <table className="pm-table compact">
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key} className={"align" in column && column.align === "right" ? "r" : undefined}>
                  {"title" in column && column.title ? <TooltipSpan text={column.title} className="pm-th-help">{column.header}</TooltipSpan> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const now = plutoNowOrFrozen(row, state, volFarmerV2BySymbol.get(row.symbol), frozenTickers.get(row.symbol));
              const who = changedBy(row);
              const cells: Record<string, React.ReactNode> = {
                switch: (
                  <>
                    <TickerSwitch row={row} withLabel locked={!isAdmin} onToggled={(enabled) => onToggled(row.id, enabled)} onError={setToggleError} />
                    {who && <span className="pm-cell-sub pm-tk-who">{who}</span>}
                  </>
                ),
                ticker: (
                  <span className="pm-tk-name">
                    <span>
                      <TickerButton symbol={row.symbol} onOpen={onOpenTicker} />
                      <FrozenTickerBadge frozen={frozenTickers.get(row.symbol)} />
                    </span>
                    <span className="co">{row.companyName ?? "—"}</span>
                  </span>
                ),
                sector: row.isEtf ? <span className="muted fst-italic">ETF</span> : row.sector ?? <span className="muted">—</span>,
                now: now ? <ToneBadge tone={now.tone} title={now.title}>{now.label}</ToneBadge> : <span className="muted">—</span>,
                dailyBars: <DailyBarsCell row={row} />,
                ivDays: <ImpliedVolatilityDaysCell row={row} />,
                earnings: <EarningsCell row={row} />,
                expiries: <OptionChainExpiriesCell expiries={row.optionChainExpiries} />,
                status: row.backfillStatus === "preparing" ? <PreparingStatusBadge progressPercent={row.backfillProgressPercent ?? 0} onClick={() => setPrepTicker({ tickerId: row.tickerId, symbol: row.symbol, companyName: row.companyName })} /> : <span className="muted">—</span>,
                ...ladderCells(row),
              };
              return (
                <tr key={row.id} className={row.botEnabled ? "on" : undefined}>
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={[("align" in column && column.align === "right") ? "r num" : "", column.key === "switch" || column.key === "dailyBars" || column.key === "earnings" ? "nw" : ""].filter(Boolean).join(" ") || undefined}>
                      {cells[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <section className="pm-card">
        <div className="pm-card-h">
          <div className="pm-min0">
            <h2 className="pm-card-t">Tickers Pluto may trade</h2>
            {!isPhone && <div className="pm-card-meta pm-meta-top">{isAdmin ? "Every Shortlist ticker. Switch one on to let Pluto trade it; the same switch is in the Shortlist's Pluto column. Each runs one strategy, Vol Farmer v2 unless set to the CC + Put Ladder." : "Every Shortlist ticker. Only an admin can switch Pluto on or off for a ticker or change its strategy."}</div>}
          </div>
          {isPhone ? (
            <span className="pm-card-meta">
              <span>
                <b className="strong num">{enabledCount}</b> of {maxEnabled} allowed
              </span>
            </span>
          ) : (
            <div className="pm-cap">
              <span>
                <b className="strong num">{enabledCount}</b> of {maxEnabled} allowed
              </span>
              <Meter pct={(enabledCount / Math.max(1, maxEnabled)) * 100} warn={enabledCount >= maxEnabled} />
            </div>
          )}
        </div>
        {toolbar}
        {allocationStrip}
        {toggleError && <div className="alert alert-danger pm-error" role="alert">{toggleError}</div>}
        {ladderError && <div className="alert alert-danger pm-error" role="alert">{ladderError}</div>}
        {savedNote && (
          <div className="pm-alert ok pm-saved-note" role="status">
            <div className="pm-alert-body">
              <div className="pm-alert-text">{savedNote}</div>
            </div>
          </div>
        )}
        {body}
        {!loading && !error && visibleRows.length > 0 && visibleRows.length < rows.length && (
          <div className="pm-card-foot">
            <span>Showing {visibleRows.length} of {rows.length}</span>
          </div>
        )}
      </section>
      {settingsSymbol && settings && ladderBySymbol.get(settingsSymbol) && (
        <PlutoLadderTickerWindow
          ticker={ladderBySymbol.get(settingsSymbol)!}
          companyName={rows.find((row) => row.symbol === settingsSymbol)?.companyName ?? null}
          enabledInPluto={rows.some((row) => row.symbol === settingsSymbol && row.botEnabled)}
          allTickers={(ladderTickers ?? []).map((ticker) => ({ settings: ticker, enabled: rows.some((row) => row.symbol === ticker.symbol && row.botEnabled) }))}
          settings={settings}
          onClose={() => setSettingsSymbol(null)}
          onEditStrategyValues={() => {
            setSettingsSymbol(null);
            onOpenSettingsTab();
          }}
          onSaved={(changeCount) => {
            setSavedNote(`${settingsSymbol} saved: ${pluralize(changeCount, "change")}. Pluto uses them from its next look.`);
            setSettingsSymbol(null);
            void loadLadder();
          }}
        />
      )}
      {prepTicker && <TickerPrepModal tickerId={prepTicker.tickerId} symbol={prepTicker.symbol} companyName={prepTicker.companyName} onRunChange={onPrepRunChange} onClose={() => setPrepTicker(null)} />}
    </>
  );
}
