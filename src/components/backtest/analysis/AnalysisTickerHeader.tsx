import type { BacktestTickerProfile, BacktestTickerSuitability } from "../../../api/backtest";
import { tickerCategoryLabels } from "../../../lib/analysisPresentation";
import { TickerSuitabilityBadge } from "../TickerSuitabilityBadge";

// The Analyse window's header (Marcelo 2026-10-19): who the ticker is, beside its symbol.

interface AnalysisTickerIdentityProps {
  symbol: string;
  profile: BacktestTickerProfile | null;
  suitability: BacktestTickerSuitability | null;
  /** Null for a trader. */
  onOpenSuitability: (() => void) | null;
}

/** Beside the symbol: the full name, kind, sector, industry and exchange, and the Suitability badge. */
export function AnalysisTickerIdentity({ symbol, profile, suitability, onOpenSuitability }: AnalysisTickerIdentityProps) {
  const details = profile ? [...tickerCategoryLabels(profile), profile.exchange].filter((label): label is string => !!label) : [];
  return (
    <div className="analysis-header-identity">
      {profile?.companyName && <span className="analysis-header-name">{profile.companyName}</span>}
      {details.length > 0 && <span className="text-secondary">{details.join(" · ")}</span>}
      <TickerSuitabilityBadge symbol={symbol} suitability={suitability} onOpen={onOpenSuitability} />
    </div>
  );
}
