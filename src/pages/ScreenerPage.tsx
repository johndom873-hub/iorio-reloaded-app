import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { TickerDetailModal } from "../components/TickerDetailModal";
import { ShortlistTab } from "../components/shortlist/ShortlistTab";
import { ScreenerTab } from "../components/screener/ScreenerTab";

type ScreenerPageTab = "screener" | "shortlist";

const tabs: { key: ScreenerPageTab; label: string }[] = [
  { key: "screener", label: "Screener" },
  { key: "shortlist", label: "Shortlist" },
];

export function ScreenerPage() {
  const [activeTab, setActiveTab] = useState<ScreenerPageTab>("shortlist");
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Screener"
        subtitle={activeTab === "screener" ? "Search for candidate tickers to monitor" : "Monitor tickers for trading opportunities"}
      />

      <ul className="nav nav-tabs mb-3">
        {tabs.map((tab) => (
          <li className="nav-item" key={tab.key}>
            <button
              type="button"
              className={`nav-link ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>

      {activeTab === "screener" ? (
        <ScreenerTab onOpenTickerDetail={setDetailSymbol} />
      ) : (
        <ShortlistTab onOpenTickerDetail={setDetailSymbol} />
      )}

      {detailSymbol && <TickerDetailModal symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
    </>
  );
}
