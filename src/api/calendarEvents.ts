import { apiRequest } from "./client";

export interface TickerCalendarEvent {
  id: string;
  symbol: string;
  eventType: "earnings" | "ex_dividend";
  eventDate: string; // YYYY-MM-DD
  eventTime: string | null;
  amount: string | null;
}

export interface EconomicCalendarEvent {
  id: string;
  title: string;
  country: string;
  category: string | null;
  importance: number | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  eventAt: string;
}

export interface CalendarEventsData {
  tickerEvents: TickerCalendarEvent[];
  economicEvents: EconomicCalendarEvent[];
}

export function fetchCalendarEvents(): Promise<CalendarEventsData> {
  return apiRequest<CalendarEventsData>("/calendar-events");
}
