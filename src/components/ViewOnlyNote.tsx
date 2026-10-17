import { IconLock } from "@tabler/icons-react";
import type { ReactNode } from "react";

/** The one line a trader sees above settings only an admin can change. */
export function ViewOnlyNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`view-only-note ${className}`}>
      <IconLock size={14} aria-hidden="true" className="text-secondary flex-shrink-0" />
      <span>
        <strong>View only.</strong> <span className="text-secondary">{children}</span>
      </span>
    </div>
  );
}
