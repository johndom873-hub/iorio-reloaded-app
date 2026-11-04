import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PortfolioTickerListing } from "../../../api/backtestPortfolio";
import { fitBadgeClass, fitLabel } from "../../../lib/portfolioSimulatorPresentation";

interface PortfolioAddTickerPickerProps {
  /** Every analysed ticker; those already in the book are left out. */
  tickers: PortfolioTickerListing[];
  inBook: string[];
  onAdd: (symbol: string) => void;
  /** The empty screen's own button: solid, as its one action. */
  primary?: boolean;
}

/**
 * Add ticker: a filter box and the analysed tickers not in the book, "suits" first, each with its fit. Portalled with a fixed
 * position (as MultiSelectDropdown), closed on a click outside, on scroll or resize, and on ESC.
 */
export function PortfolioAddTickerPicker({ tickers, inBook, onAdd, primary = false }: PortfolioAddTickerPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)) });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const filter = filterText.trim().toUpperCase();
  const choices = tickers
    .filter((ticker) => !inBook.includes(ticker.symbol) && (filter === "" || ticker.symbol.includes(filter)))
    .sort((a, b) => Number(b.verdict === "suits") - Number(a.verdict === "suits") || a.symbol.localeCompare(b.symbol));

  return (
    <>
      <button ref={buttonRef} type="button" className={`btn ${primary ? "btn-primary" : "btn-outline-secondary"}`} aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
        Add ticker
      </button>
      {isOpen &&
        position &&
        createPortal(
          <div ref={menuRef} className="dropdown-menu show portfolio-add-ticker-menu" style={{ position: "fixed", top: position.top, left: position.left }}>
            <div className="px-2 pb-2">
              <input className="form-control" placeholder="Filter" aria-label="Filter tickers" value={filterText} autoFocus onChange={(event) => setFilterText(event.target.value)} />
            </div>
            <div className="portfolio-add-ticker-list">
              {choices.length === 0 && <div className="dropdown-item-text text-secondary">No analysed ticker left to add.</div>}
              {choices.map((ticker) => (
                <button
                  key={ticker.symbol}
                  type="button"
                  className="dropdown-item d-flex align-items-center justify-content-between gap-2"
                  onClick={() => {
                    onAdd(ticker.symbol);
                    setFilterText("");
                  }}
                >
                  <span className="fw-semibold">{ticker.symbol}</span>
                  <span className={fitBadgeClass(ticker.verdict)}>{fitLabel(ticker.verdict)}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
