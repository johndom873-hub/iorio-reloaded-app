import { apiRequest } from "./client";

/** A major US macro event (Fed rate decision, CPI, GDP, US federal election). */
export interface MacroEvent {
  dateIso: string; // Eastern date
  eventAtIso: string; // the release instant (UTC ISO)
  title: string;
}

export interface TickerCalendarEvent {
  id: string;
  symbol: string;
  eventType: "earnings" | "ex_dividend";
  eventDate: string; // YYYY-MM-DD
  eventTime: string | null;
  amount: string | null;
}

export interface CalendarEventsData {
  tickerEvents: TickerCalendarEvent[];
  /** The major US macro events (Fed rate decision, CPI, GDP, US federal elections), the same list the Signals flag and Pluto read. */
  macroEvents: MacroEvent[];
}

export function fetchCalendarEvents(): Promise<CalendarEventsData> {
  return apiRequest<CalendarEventsData>("/calendar-events");
}

export interface NextTickerCalendarEvents {
  nextEarningsDate: string | null; // YYYY-MM-DD
  nextExDividendDate: string | null; // YYYY-MM-DD
}

export function fetchNextTickerCalendarEvents(symbol: string): Promise<NextTickerCalendarEvents> {
  return apiRequest<NextTickerCalendarEvents>(`/calendar-events/next/${encodeURIComponent(symbol)}`);
}
