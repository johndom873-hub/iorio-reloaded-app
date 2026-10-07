import { apiRequest } from "./client";
import type { MacroEvent } from "./signals";

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
