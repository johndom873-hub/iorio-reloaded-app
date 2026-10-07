/** The superscript "P" after a ticker Pluto may trade (Signals and Pulse). */
export function PlutoManagedMark({ symbol, managed }: { symbol: string; managed: boolean }) {
  if (!managed) return null;
  return (
    <sup className="pluto-managed-mark" title={`Pluto may trade ${symbol}`} aria-label="managed by Pluto">
      P
    </sup>
  );
}
