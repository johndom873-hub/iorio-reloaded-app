// Shared formatting helpers. Any new formatting logic anywhere in the app
// should be added here rather than inlined at the call site.

export function formatCurrency(amountInDollars: number | null | undefined): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountInDollars);
}

export function formatPercentage(fractionOrNull: number | null | undefined, decimalPlaces = 1): string {
  if (fractionOrNull === null || fractionOrNull === undefined) return "—";
  return `${(fractionOrNull * 100).toFixed(decimalPlaces)}%`;
}

export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function formatDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value: number | string | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined) return "—";
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numericValue)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(numericValue);
}

export function formatDuration(
  startedAt: string | Date | null | undefined,
  finishedAt: string | Date | null | undefined,
): string {
  if (!startedAt) return "—";
  if (!finishedAt) return "running…";

  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const end = typeof finishedAt === "string" ? new Date(finishedAt) : finishedAt;
  const totalSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatSignedPnl(amountInDollars: number | null | undefined): string {
  if (amountInDollars === null || amountInDollars === undefined) return "—";
  const formatted = formatCurrency(Math.abs(amountInDollars));
  if (amountInDollars > 0) return `+${formatted}`;
  if (amountInDollars < 0) return `-${formatted}`;
  return formatted;
}
