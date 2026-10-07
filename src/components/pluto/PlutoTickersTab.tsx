import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { updateShortlistBotEnabled, type PlutoState } from "../../api/pluto";
import type { ShortlistRow, TickerBackfillRun } from "../../api/shortlist";
import { formatBrowserDayMonth, pluralize } from "../../lib/formatters";
import { ColumnVisibilityPopover } from "../DataTable/ColumnVisibilityPopover";
import { useColumnVisibility } from "../DataTable/useColumnVisibility";
import { Spinner } from "../Spinner";
import { TooltipSpan } from "../TooltipSpan";
import { VolatilitySurfaceModal } from "../VolatilitySurfaceModal";
import { DailyBarsCell, DividendCell, EarningsCell, OptionChainExpiriesCell, PreparingStatusBadge, SnapshotsCell, SurfaceFitCell } from "../shortlist/readinessCells";
import { TickerPrepModal } from "../shortlist/TickerPrepModal";
import { Meter, SearchIcon, TickerButton, ToneBadge } from "./plutoBits";

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
}

type Filter = "all" | "on" | "off";

const columns = [
  { key: "switch", header: "Pluto may trade" },
  { key: "ticker", header: "Ticker" },
  { key: "sector", header: "Sector" },
  { key: "now", header: "Pluto now" },
  { key: "dailyBars", header: "Daily bars", title: "Daily price/IV history", align: "right" },
  { key: "earnings", header: "Earnings", title: "Earnings dates on record", align: "right" },
  { key: "dividend", header: "Dividend", title: "Regular ex-dividend cadence" },
  { key: "snapshots", header: "Snapshots", title: "Nightly option-chain captures on record", align: "right" },
  { key: "expiries", header: "Chain expiries", title: "Expiries with strikes captured", align: "right" },
  { key: "surface", header: "Surface fit", title: "Fitted vs total expiries; click to open the surface", align: "right" },
  { key: "status", header: "Status" },
] as const;

/** The per-ticker switch in the mockup's own style; saves on click, the cap error comes back from the API. */
function TickerSwitch({ row, onToggled, onError, withLabel }: { row: ShortlistRow; onToggled: (enabled: boolean) => void; onError: (message: string) => void; withLabel: boolean }) {
  const [saving, setSaving] = useState(false);
  async function toggle() {
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
    <label className="pm-switch">
      <input type="checkbox" role="switch" checked={row.botEnabled} disabled={saving} onChange={() => void toggle()} aria-label={`Pluto may trade ${row.symbol}`} />
      {withLabel && <span className={`pm-switch-state ${row.botEnabled ? "on" : "off"}`}>{saving ? <Spinner size="sm" /> : row.botEnabled ? "Allowed" : "Off"}</span>}
    </label>
  );
}

function plutoNow(row: ShortlistRow, state: PlutoState | null): { tone: "neutral" | "info"; label: string } | null {
  const working = state?.book.workingOrdersBySymbol[row.symbol] ?? 0;
  if (working > 0) return { tone: "info", label: pluralize(working, "working order") };
  const open = state?.book.openPositionsBySymbol[row.symbol] ?? 0;
  if (open > 0) return { tone: "neutral", label: pluralize(open, "open position") };
  return null;
}

function changedBy(row: ShortlistRow): string | null {
  if (!row.botEnabledChangedAt) return null;
  return `${row.botEnabledChangedBy ?? "—"} · ${formatBrowserDayMonth(row.botEnabledChangedAt)}`;
}

export function PlutoTickersTab({ rows, loading, error, state, maxEnabled, isPhone, onOpenTicker, onToggled, onPrepRunChange }: PlutoTickersTabProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [surfaceSymbol, setSurfaceSymbol] = useState<string | null>(null);
  const [prepTicker, setPrepTicker] = useState<{ tickerId: string; symbol: string; companyName: string | null } | null>(null);
  const { isColumnVisible, toggleColumn } = useColumnVisibility("pluto-tickers", columns.map((column) => column.key));

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

  let body: React.ReactNode;
  if (error) body = <div className="alert alert-danger pm-error mb-0">{error}</div>;
  else if (loading) body = <div className="pm-empty"><Spinner size="sm" label="Loading tickers" /></div>;
  else if (visibleRows.length === 0) body = <div className="pm-empty">{rows.length === 0 ? "No Signals tickers yet — turn Signals on for a ticker on the Shortlist first." : "No tickers match."}</div>;
  else if (isPhone) {
    body = (
      <ul className="pm-mlist">
        {visibleRows.map((row) => {
          const now = plutoNow(row, state);
          return (
            <li key={row.id} className={`pm-m-tk${row.botEnabled ? " on" : ""}`}>
              <TickerSwitch row={row} withLabel={false} onToggled={(enabled) => onToggled(row.id, enabled)} onError={setToggleError} />
              <span className="pm-tk-name">
                <span>
                  <TickerButton symbol={row.symbol} onOpen={onOpenTicker} />{" "}
                  {row.latestTotalSliceCount !== null && (
                    <button type="button" className="pm-link num surface" onClick={() => setSurfaceSymbol(row.symbol)} title={`Open the ${row.symbol} volatility surface`}>
                      Surface {row.latestFittedSliceCount}/{row.latestTotalSliceCount}
                    </button>
                  )}
                </span>
                <span className="co">{row.companyName ?? "—"}</span>
              </span>
              <span className="right">
                <span className={`pm-switch-state ${row.botEnabled ? "on" : "off"}`}>{row.botEnabled ? "Allowed" : "Off"}</span>
                {now && <ToneBadge tone={now.tone}>{now.label}</ToneBadge>}
              </span>
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
              const now = plutoNow(row, state);
              const who = changedBy(row);
              const cells: Record<string, React.ReactNode> = {
                switch: (
                  <>
                    <TickerSwitch row={row} withLabel onToggled={(enabled) => onToggled(row.id, enabled)} onError={setToggleError} />
                    {who && <span className="pm-cell-sub pm-tk-who">{who}</span>}
                  </>
                ),
                ticker: (
                  <span className="pm-tk-name">
                    <TickerButton symbol={row.symbol} onOpen={onOpenTicker} />
                    <span className="co">{row.companyName ?? "—"}</span>
                  </span>
                ),
                sector: row.isEtf ? <span className="muted fst-italic">ETF</span> : row.sector ?? <span className="muted">—</span>,
                now: now ? <ToneBadge tone={now.tone}>{now.label}</ToneBadge> : <span className="muted">—</span>,
                dailyBars: <DailyBarsCell row={row} />,
                earnings: <EarningsCell row={row} />,
                dividend: <DividendCell row={row} />,
                snapshots: <SnapshotsCell row={row} />,
                expiries: <OptionChainExpiriesCell expiries={row.optionChainExpiries} />,
                surface: <SurfaceFitCell row={row} onOpenSurface={() => setSurfaceSymbol(row.symbol)} linkClassName="pm-link num" />,
                status: row.backfillStatus === "preparing" ? <PreparingStatusBadge progressPercent={row.backfillProgressPercent ?? 0} onClick={() => setPrepTicker({ tickerId: row.tickerId, symbol: row.symbol, companyName: row.companyName })} /> : <span className="muted">—</span>,
              };
              return (
                <tr key={row.id} className={row.botEnabled ? "on" : undefined}>
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={[("align" in column && column.align === "right") ? "r num" : "", column.key === "switch" || column.key === "dailyBars" || column.key === "earnings" || column.key === "surface" ? "nw" : ""].filter(Boolean).join(" ") || undefined}>
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
            {!isPhone && <div className="pm-card-meta pm-meta-top">Every Shortlist ticker with Signals on. Switch one on to let Pluto trade it; the same switch is in the Shortlist's Pluto column.</div>}
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
        {toggleError && <div className="alert alert-danger pm-error" role="alert">{toggleError}</div>}
        {body}
        {!loading && !error && visibleRows.length > 0 && visibleRows.length < rows.length && (
          <div className="pm-card-foot">
            <span>Showing {visibleRows.length} of {rows.length}</span>
          </div>
        )}
      </section>
      {surfaceSymbol && <VolatilitySurfaceModal symbol={surfaceSymbol} onClose={() => setSurfaceSymbol(null)} />}
      {prepTicker && <TickerPrepModal tickerId={prepTicker.tickerId} symbol={prepTicker.symbol} companyName={prepTicker.companyName} onRunChange={onPrepRunChange} onClose={() => setPrepTicker(null)} />}
    </>
  );
}
