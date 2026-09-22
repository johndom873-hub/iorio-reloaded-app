import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { AppEnvironment, EnvironmentDetails, PublicEnvironment, TradingMode } from "../../api/environment";
import { usePublicEnvironment, type EnvironmentStatus } from "../../hooks/useEnvironmentStatus";
import { formatRelativeDate } from "../../lib/formatters";
import "./EnvironmentBadges.css";

type ChipKind = "paper" | "live" | "staging" | "dev" | "blocked" | "unknown";

interface Chip {
  kind: ChipKind;
  label: string;
}

const environmentLabels: Record<AppEnvironment, string> = { development: "Development", staging: "Staging", production: "Production" };

// LIVE appears only in production and production is never paper; paper exists only in staging and dev
// (Marcelo's rule, 2026-09-22). A combination outside that is shown as an unknown chip, never as a
// reassuring PAPER or a missing badge.
function chipsForEnvironment(environment: AppEnvironment, tradingMode: TradingMode): Chip[] {
  if (environment === "production") {
    return tradingMode === "live"
      ? [{ kind: "live", label: "Live" }]
      : [{ kind: "unknown", label: "Prod · paper?" }];
  }
  if (tradingMode === "live") return [{ kind: "unknown", label: `${environmentLabels[environment]} · live?` }];
  const environmentChip: Chip =
    environment === "staging" ? { kind: "staging", label: "Staging" } : { kind: "dev", label: "Dev" };
  return [environmentChip, { kind: "paper", label: "Paper" }];
}

const unknownChip: Chip = { kind: "unknown", label: "Env ?" };

function chipsForStatus(status: EnvironmentStatus): Chip[] {
  const { details, unknown } = status;
  if (unknown || details === null) return [unknownChip];
  const chips = chipsForEnvironment(details.environment, details.tradingMode);
  if (details.trading.state === "blocked") chips.push({ kind: "blocked", label: "Trading blocked" });
  if (details.trading.state === "offline") chips.push({ kind: "blocked", label: "Worker offline" });
  return chips;
}

function ChipView({ chip }: { chip: Chip }) {
  return (
    <span className={`env-badge env-badge-${chip.kind}`}>
      {chip.kind === "live" && <span className="env-badge-dot" aria-hidden="true" />}
      {chip.kind === "blocked" && <IconAlertTriangle size={12} stroke={2.4} aria-hidden="true" />}
      <span className="env-badge-text">{chip.label}</span>
    </span>
  );
}

function PopoverRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="env-popover-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function EnvironmentPopover({ status }: { status: EnvironmentStatus }) {
  const { details, unknown } = status;
  if (unknown || details === null) {
    return (
      <div className="env-popover" role="dialog" aria-label="Environment details">
        <div className="env-popover-title">Environment unknown</div>
        <div className="small">The app could not confirm which environment it is talking to. Do not trade until this badge shows a known environment.</div>
      </div>
    );
  }
  const title = details.trading.state === "ok" ? `${environmentLabels[details.environment]} · ${details.tradingMode} · trading OK` : details.trading.state === "offline" ? "Worker offline" : "Trading blocked";
  const worker: EnvironmentDetails["worker"] = details.worker;
  return (
    <div className="env-popover" role="dialog" aria-label="Environment details">
      <div className="env-popover-title">{title}</div>
      <PopoverRow label="Environment" value={details.environment} />
      <PopoverRow label="Trading mode" value={details.tradingMode} />
      <PopoverRow label="IBKR account" value={worker?.accountId ?? "—"} />
      <PopoverRow label="Worker version" value={worker?.gitSha ?? "—"} />
      <PopoverRow label="Account binding" value={worker?.bindingStatus ?? "—"} />
      <PopoverRow label="Worker heartbeat" value={worker ? formatRelativeDate(new Date(Date.now() - worker.heartbeatAgeSeconds * 1000)) : "never"} />
      {details.trading.reason && <div className="env-popover-reason">{details.trading.reason}</div>}
    </div>
  );
}

/** Top-bar badges: environment, trading mode and trading health. Click (or tap) for details. */
export function EnvironmentBadges({ status }: { status: EnvironmentStatus }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chips = chipsForStatus(status);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const summary = chips.map((chip) => chip.label).join(", ");
  return (
    <div ref={containerRef} className="env-badges">
      <button
        type="button"
        className="env-badges-trigger"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Environment: ${summary}. Show details`}
        onClick={() => setIsOpen((open) => !open)}
      >
        {chips.map((chip) => (
          <ChipView key={chip.kind} chip={chip} />
        ))}
      </button>
      {isOpen && <EnvironmentPopover status={status} />}
    </div>
  );
}

/** Login page: environment and mode only (no details, no session needed). Renders nothing while loading; a failed request shows the unknown chip. */
export function PublicEnvironmentBadges() {
  const environment = usePublicEnvironment();
  if (environment === null) return null;
  const chips = environment === "failed" ? [unknownChip] : chipsForEnvironment((environment as PublicEnvironment).environment, (environment as PublicEnvironment).tradingMode);
  return (
    <div className="env-badges env-badges-on-page justify-content-center" role="status" aria-label={`Environment: ${chips.map((chip) => chip.label).join(", ")}`}>
      <span className="d-flex align-items-center gap-2">
        {chips.map((chip) => (
          <ChipView key={chip.kind} chip={chip} />
        ))}
      </span>
    </div>
  );
}
