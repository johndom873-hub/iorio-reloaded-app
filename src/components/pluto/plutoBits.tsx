import { IconChevronDown, IconChevronUp, IconExternalLink } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PlutoActionContract, PlutoActionKind } from "../../api/pluto";
import { strategyBadgeFor, type PlutoBadgeTone } from "../../lib/plutoPresentation";

// Small presentational pieces shared by the Pluto screen's cards (mockup classes, see PlutoPage.css).

const strategyColourClasses = { cc: "bg-blue text-white", csp: "bg-purple text-white", ns: "bg-orange text-white" } as const;

export function StrategyBadge({ kind, contract }: { kind: PlutoActionKind; contract: PlutoActionContract | null }) {
  const badge = strategyBadgeFor(kind, contract);
  return <span className={`badge pm-strat ${strategyColourClasses[badge.className]}`}>{badge.label}</span>;
}

export function GradeBadge({ grade }: { grade: string }) {
  const known = grade === "strong" || grade === "good" || grade === "weak" || grade === "avoid";
  return <span className={`badge pm-grade badge-grade-${known ? grade : "avoid"}`}>{grade.charAt(0).toUpperCase() + grade.slice(1)}</span>;
}

export function TickerButton({ symbol, onOpen }: { symbol: string; onOpen: (symbol: string) => void }) {
  return (
    <button type="button" className="pm-tkr" onClick={() => onOpen(symbol)} title={`Open ${symbol} in Signals`}>
      {symbol}
    </button>
  );
}

export function ToneBadge({ tone, children, title }: { tone: PlutoBadgeTone; children: ReactNode; title?: string }) {
  return (
    <span className={`pm-b ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** An outcome badge that opens the order in the Trade Blotter when there is one. */
export function OrderOutcomeBadge({ tone, label, orderRequestId, icon }: { tone: PlutoBadgeTone; label: string; orderRequestId: string | null; icon?: ReactNode }) {
  if (!orderRequestId) {
    return (
      <span className={`pm-b ${tone}`}>
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Link className={`pm-b ${tone}`} to={`/trade-blotter?order=${encodeURIComponent(orderRequestId)}`} title="Open the order in the Trade Blotter">
      {icon}
      {label}
      <IconExternalLink className="ic" aria-hidden="true" />
    </Link>
  );
}

export function Meter({ pct, warn = false }: { pct: number; warn?: boolean }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className={`pm-meter${warn ? " warn" : ""}`} aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function CollapseButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="pm-iconbtn" aria-label={open ? `Collapse ${label}` : `Expand ${label}`} aria-expanded={open} onClick={onToggle}>
      {open ? <IconChevronUp className="ic" /> : <IconChevronDown className="ic" />}
    </button>
  );
}

export function ChevronRightIcon() {
  return <IconChevronRightSmall />;
}

function IconChevronRightSmall() {
  return (
    <svg className="ic sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ className = "ic sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function CrossIcon({ className = "ic sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function WarningIcon({ className = "ic" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87l-8.106-13.536a1.914 1.914 0 0 0-3.274 0z" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function InfoIcon({ className = "ic" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

export function StopIcon({ className = "ic" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

export function ResetIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M21 21l-6-6" />
    </svg>
  );
}

export function ExternalIcon() {
  return <IconExternalLink className="ic sm" aria-hidden="true" />;
}

/** "All orders ›" style card link. */
export function CardLink({ to, children, small = false }: { to: string; children: ReactNode; small?: boolean }) {
  return (
    <Link className={`pm-link${small ? " small" : ""}`} to={to}>
      {children}
      <ChevronRightIcon />
    </Link>
  );
}
