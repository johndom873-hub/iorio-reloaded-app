import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-header d-print-none">
      <div className="row align-items-center">
        <div className="col">
          <h2 className="page-title">{title}</h2>
          {subtitle && <div className="text-secondary mt-1">{subtitle}</div>}
        </div>
        {actions && <div className="col-auto ms-auto d-flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}
