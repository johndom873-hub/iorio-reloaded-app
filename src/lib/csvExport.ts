// Shared CSV export: build RFC 4180 text from rows and hand it to the browser as a file download.

export interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => string | number | boolean | null | undefined;
}

function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One header line, then one line per row; fields with commas, quotes or line breaks are quoted. */
export function buildCsvText<TRow>(columns: CsvColumn<TRow>[], rows: TRow[]): string {
  const lines = [columns.map((column) => csvField(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvField(column.value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Saves text as a file through a temporary object URL. */
export function downloadTextFile(fileName: string, text: string, mimeType = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
