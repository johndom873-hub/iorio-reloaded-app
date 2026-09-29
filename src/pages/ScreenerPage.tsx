import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { ShortlistTab } from "../components/shortlist/ShortlistTab";
import { ScreenerTab } from "../components/screener/ScreenerTab";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";

type ScreenerPageTab = "screener" | "shortlist";

const tabs: { key: ScreenerPageTab; label: string }[] = [
  { key: "screener", label: "Screener" },
  { key: "shortlist", label: "Shortlist" },
];

export function ScreenerPage() {
  const [activeTab, setActiveTab] = useState<ScreenerPageTab>("shortlist");
  const { open: openTickerModal } = useSignalsTickerModal();

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
        <ScreenerTab onOpenTickerModal={openTickerModal} />
      ) : (
        <ShortlistTab onOpenTickerModal={openTickerModal} />
      )}

    </>
  );
}
