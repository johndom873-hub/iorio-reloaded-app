import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable, type DataTableColumn } from "../components/DataTable/DataTable";
import { ApiError } from "../api/client";
import { fetchCalendarEvents, type TickerCalendarEvent } from "../api/calendarEvents";
import type { MacroEvent } from "../api/signals";
import { daysToExpiry, formatCurrency, formatDate, formatDaysToExpiry, formatEasternTime, todayInEasternIso } from "../lib/formatters";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";

function DateWithCountdown({ isoDate }: { isoDate: string }) {
  return (
    <span className="text-nowrap">
      {formatDate(isoDate)}{" "}
      <span className="text-secondary" style={{ fontSize: "0.72rem" }}>
        ({formatDaysToExpiry(daysToExpiry(isoDate, todayInEasternIso()))})
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

export function CalendarEventsPage() {
  const [tickerEvents, setTickerEvents] = useState<TickerCalendarEvent[]>([]);
  const [macroEvents, setMacroEvents] = useState<MacroEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { open: openTickerModal } = useSignalsTickerModal();

  const loadEvents = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchCalendarEvents();
      setTickerEvents(result.tickerEvents);
      setMacroEvents(result.macroEvents);
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
          onClick={() => openTickerModal(row.symbol)}
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

  const macroColumns: DataTableColumn<MacroEvent>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => <DateWithCountdown isoDate={row.dateIso} />,
    },
    { key: "time", header: "Time", render: (row) => <span className="text-nowrap">{formatEasternTime(row.eventAtIso)}</span> },
    { key: "title", header: "Event", render: (row) => row.title },
  ];

  return (
    <>
      <PageHeader title="Calendar" subtitle="Upcoming earnings, ex-dividend, and macro events" />

      {error && <div className="alert alert-danger">{error}</div>}

      <h3 className="mb-2">Ticker Events</h3>
      <DataTable
        tableId="calendar-ticker-events"
        dense
        columns={tickerColumns}
        rows={tickerEvents}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No upcoming earnings or ex-dividend dates for your shortlist or open positions."
      />

      <h3 className="mb-2 mt-4">Major Macro Events</h3>
      <DataTable
        tableId="calendar-macro-events"
        dense
        columns={macroColumns}
        rows={macroEvents}
        rowKey={(row) => `${row.eventAtIso}-${row.title}`}
        loading={loading}
        emptyMessage="No upcoming major macro events."
      />

    </>
  );
}
