import type { SavedPortfolio } from "../../../api/backtestPortfolio";
import { formatDateTime } from "../../../lib/formatters";
import { Spinner } from "../../Spinner";

interface PortfolioBarProps {
  portfolios: SavedPortfolio[];
  /** The open portfolio's id; null for a new one not saved yet. */
  openId: string | null;
  unsaved: boolean;
  /** When the open portfolio was last saved. */
  savedAt: string | null;
  hasTickers: boolean;
  saving: boolean;
  compareWithId: string | null;
  onOpen: (id: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNew: () => void;
  onDelete: () => void;
  onCompareWith: (id: string | null) => void;
}

const newPortfolioValue = "";

/** The saved portfolios: which one is open, its unsaved changes, Save, Save as, New, Delete, and the portfolio compared with. */
export function PortfolioBar({ portfolios, openId, unsaved, savedAt, hasTickers, saving, compareWithId, onOpen, onSave, onSaveAs, onNew, onDelete, onCompareWith }: PortfolioBarProps) {
  const compareChoices = portfolios.filter((portfolio) => portfolio.id !== openId);
  return (
    <div className="card">
      <div className="card-body">
        <div className="portfolio-bar">
          <div className="portfolio-bar-control">
            <label htmlFor="portfolio-open" className="portfolio-bar-label">
              Portfolio
            </label>
            <select id="portfolio-open" className="form-select portfolio-bar-select" value={openId ?? newPortfolioValue} onChange={(event) => event.target.value !== newPortfolioValue && onOpen(event.target.value)}>
              {openId === null && <option value={newPortfolioValue}>New portfolio (not saved)</option>}
              {portfolios.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </select>
          </div>
          {unsaved && <span className="badge bg-warning-lt">Unsaved changes</span>}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" disabled={saving || (openId !== null ? !unsaved : !hasTickers)} onClick={onSave}>
              {saving && <Spinner size="sm" />}
              Save
            </button>
            <button type="button" className="btn btn-outline-secondary" disabled={saving || openId === null} onClick={onSaveAs}>
              Save as…
            </button>
            <button type="button" className="btn btn-outline-secondary" disabled={saving || (openId === null && !hasTickers)} onClick={onNew}>
              New
            </button>
            {openId !== null && (
              <button type="button" className="btn btn-outline-danger" disabled={saving} onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
          <span className="portfolio-bar-spacer" />
          <div className="portfolio-bar-control">
            <label htmlFor="portfolio-compare" className="portfolio-bar-label">
              Compare with
            </label>
            <select
              id="portfolio-compare"
              className="form-select portfolio-bar-select"
              value={compareWithId ?? ""}
              disabled={compareChoices.length === 0}
              onChange={(event) => onCompareWith(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">None</option>
              {compareChoices.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-secondary mt-2" style={{ fontSize: "0.8rem" }}>
          {savedAt ? `Saved ${formatDateTime(savedAt)} · ` : "Not saved yet · "}a portfolio holds its tickers, their allocations and the account. Horizon, drift and paths are this browser's view settings.
        </div>
      </div>
    </div>
  );
}
