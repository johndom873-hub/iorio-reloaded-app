import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ApiError } from "../api/client";
import {
  fetchCalendarEvents,
  type EconomicCalendarEvent,
  type TickerCalendarEvent,
} from "../api/calendarEvents";
import { daysToExpiry, formatCurrency, formatDate, formatDaysToExpiry } from "../lib/formatters";

function DateWithCountdown({ isoDate }: { isoDate: string }) {
  return (
    <span className="text-nowrap">
      {formatDate(isoDate)}{" "}
      <span className="text-secondary" style={{ fontSize: "0.72rem" }}>
        ({formatDaysToExpiry(daysToExpiry(isoDate))})
      </span>
    </span>
  );
}

// TradingView's earnings_release_time/earnings_release_next_time code:
// 1 = before market open, 2 = after market close, 0/other = unspecified.
// Not documented by TradingView -- inferred from observed values; shown
// as the raw code rather than guessed prose when it doesn't match.
function formatEarningsTime(eventTime: string | null): string {
  if (eventTime === "1") return "Pre-market";
  if (eventTime === "2") return "After close";
  return "—";
}

// TradingView's economic-calendar importance scale runs -1 (unrated, e.g.
// bill auctions) through 2 (High) -- not documented, inferred from observed
// data (found 2026-08-30: -1 rows exist and aren't just "0 = Low").
const importanceBadgeClass: Record<number, string> = {
  "-1": "bg-secondary-lt",
  0: "bg-secondary-lt",
  1: "bg-yellow-lt",
  2: "bg-danger-lt",
};

const importanceLabel: Record<number, string> = {
  "-1": "Unrated",
  0: "Low",
  1: "Medium",
  2: "High",
};

export function CalendarEventsPage() {
  const [tickerEvents, setTickerEvents] = useState<TickerCalendarEvent[]>([]);
  const [economicEvents, setEconomicEvents] = useState<EconomicCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchCalendarEvents();
      setTickerEvents(result.tickerEvents);
      setEconomicEvents(result.economicEvents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load calendar events.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadEvents().finally(() => setLoading(false));
  }, [loadEvents]);

  const tickerColumns: DataTableColumn<TickerCalendarEvent>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => <DateWithCountdown isoDate={row.eventDate} />,
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => (
        <button
          type="button"
          className="btn btn-link p-0 text-decoration-none fw-bold"
          onClick={() => setDetailSymbol(row.symbol)}
        >
          {row.symbol}
        </button>
      ),
    },
    {
      key: "eventType",
      header: "Event",
      render: (row) => (
        <span className={`badge ${row.eventType === "earnings" ? "bg-azure-lt" : "bg-purple text-white"}`}>
          {row.eventType === "earnings" ? "Earnings" : "Ex-Dividend"}
        </span>
      ),
    },
    {
      key: "eventTime",
      header: "Time",
      render: (row) => (row.eventType === "earnings" ? formatEarningsTime(row.eventTime) : "—"),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (row.amount === null ? "—" : formatCurrency(Number(row.amount))),
    },
  ];

  const economicColumns: DataTableColumn<EconomicCalendarEvent>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => <DateWithCountdown isoDate={row.eventAt} />,
    },
    { key: "title", header: "Event", render: (row) => row.title },
    { key: "country", header: "Country", render: (row) => row.country },
    {
      key: "importance",
      header: "Importance",
      render: (row) =>
        row.importance === null ? (
          "—"
        ) : (
          <span className={`badge ${importanceBadgeClass[row.importance] ?? "bg-secondary-lt"}`}>
            {importanceLabel[row.importance] ?? row.importance}
          </span>
        ),
    },
    {
      key: "actual",
      header: "Actual",
      align: "right",
      render: (row) => row.actual ?? "—",
    },
    {
      key: "forecast",
      header: "Forecast",
      align: "right",
      render: (row) => row.forecast ?? "—",
    },
    {
      key: "previous",
      header: "Previous",
      align: "right",
      render: (row) => row.previous ?? "—",
    },
  ];

  return (
    <>
      <PageHeader title="Calendar" subtitle="Upcoming earnings, ex-dividend, and macro events" />

      {error && <div className="alert alert-danger">{error}</div>}

      <h3 className="mb-2">Ticker Events</h3>
      <DataTable
        tableId="calendar-ticker-events"
        columns={tickerColumns}
        rows={tickerEvents}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No upcoming earnings or ex-dividend dates for your shortlist or open positions."
      />

      <h3 className="mb-2 mt-4">Economic Events</h3>
      <DataTable
        tableId="calendar-economic-events"
        columns={economicColumns}
        rows={economicEvents}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No upcoming economic events."
      />

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
