import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { ShortlistTab } from "../components/shortlist/ShortlistTab";
import { ScreenerTab } from "../components/screener/ScreenerTab";
import { useSignalsTickerModal } from "../hooks/useSignalsTickerModal";

type ShortlistPageTab = "shortlist" | "screener";

const tabs: { key: ShortlistPageTab; label: string }[] = [
  { key: "shortlist", label: "Shortlist" },
  { key: "screener", label: "Screener" },
];

export function ShortlistPage() {
  const [activeTab, setActiveTab] = useState<ShortlistPageTab>("shortlist");
  const { open: openTickerModal } = useSignalsTickerModal();

  return (
    <>
      <PageHeader
        title="Shortlist"
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
