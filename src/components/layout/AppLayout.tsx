import { NavLink, Outlet } from "react-router-dom";
import {
  IconChartCandle,
  IconClipboardList,
  IconHeartRateMonitor,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconReceipt2,
  IconSearch,
  IconShieldCheck,
  IconSun,
} from "@tabler/icons-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";

const navigationItems = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard, end: true },
  { to: "/positions", label: "Positions", icon: IconChartCandle },
  { to: "/trade-alerts", label: "Trade Alerts", icon: IconClipboardList },
  { to: "/screener-shortlist", label: "Screener & Shortlist", icon: IconSearch },
  { to: "/trade-blotter", label: "Trade Blotter", icon: IconReceipt2 },
  { to: "/risk-limits", label: "Risk & Limits", icon: IconShieldCheck },
  { to: "/system-health", label: "System Health", icon: IconHeartRateMonitor },
];

export function AppLayout() {
  const { currentUser, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="page">
      <aside className="navbar navbar-vertical navbar-expand-lg navbar-dark iorio-sidebar">
        <div className="container-fluid">
          <h1 className="navbar-brand">
            <img src="/icon-mark.svg" alt="" width="32" height="19" className="me-2" />
            <span className="d-flex flex-column lh-1">
              <span className="iorio-wordmark iorio-wordmark-primary fw-bold fs-3">IORIO</span>
              <span className="iorio-wordmark-secondary">RELOADED</span>
            </span>
          </h1>
          <button
            type="button"
            className="navbar-toggler"
            data-bs-toggle="collapse"
            data-bs-target="#sidebar-menu"
            aria-controls="sidebar-menu"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon" />
          </button>
          <div className="collapse navbar-collapse" id="sidebar-menu">
            <ul className="navbar-nav">
              {navigationItems.map(({ to, label, icon: Icon, end }) => (
                <li className="nav-item" key={to}>
                  <NavLink to={to} end={end} className="nav-link">
                    <span className="nav-link-icon d-md-none d-lg-inline-block">
                      <Icon size={20} />
                    </span>
                    <span className="nav-link-title">{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <header className="navbar navbar-expand-md d-print-none">
        <div className="container-fluid">
          <div className="ms-auto d-flex align-items-center gap-3">
            <button
              type="button"
              className="btn btn-icon"
              title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={toggleTheme}
            >
              {theme === "light" ? <IconMoon size={20} /> : <IconSun size={20} />}
            </button>
            <span className="text-secondary">{currentUser?.displayName}</span>
            <button type="button" className="btn btn-icon" title="Log out" onClick={() => void logout()}>
              <IconLogout size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="page-wrapper">
        <div className="page-body">
          <div className="container-fluid px-3">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
