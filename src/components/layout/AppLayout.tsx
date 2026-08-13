import { useEffect, useRef } from "react";
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
  { to: "/screener", label: "Screener", icon: IconSearch },
  { to: "/trade-blotter", label: "Trade Blotter", icon: IconReceipt2 },
  { to: "/risk-limits", label: "Risk & Limits", icon: IconShieldCheck },
  { to: "/system-health", label: "System Health", icon: IconHeartRateMonitor },
];

// Matches the fixed geometry in theme.css's sidebar rules: nav links
// inset by --tblr-page-padding (16px) on the left, mirrored on the right
// (rather than added as separate "breathing room") so the rail sizes
// tightly instead of padding twice. The logo lives in the top bar, not
// the nav rail — it's not part of this width calculation at all.
// Collapsed width excludes the icon-to-label gap: theme.css zeroes
// nav-link-icon's margin-right while collapsed (restored on hover), so
// there's nothing for that gap to push against — including it here
// would reserve dead space and throw off the icon's centering.
const SIDEBAR_ROW_INSET_PX = 16;
const NAV_ICON_WIDTH_PX = 20;
const NAV_ICON_LABEL_GAP_PX = 8;

function BrandMark() {
  // The full icon+wordmark lockup, not reconstructed from a live web
  // font — the brand pack (public/brand/) only ships it as a flat
  // image, and its lettering isn't a system/Google font, so recreating
  // it with text spans drifted from the approved artwork. The sidebar
  // and top bar are always dark navy regardless of the theme toggle,
  // so this always uses the dark-background lockup variant (the
  // light-background one is for the login page, which does follow the
  // theme toggle — see LoginPage.tsx).
  return <img src="/brand/iorio-lockup-dark.png" alt="Iorio Reloaded" width="181" height="52" />;
}

export function AppLayout() {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navTitleRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const measureAndApply = () => {
      const widestNavTitle = navTitleRefs.current.reduce(
        (max, el) => Math.max(max, el?.scrollWidth ?? 0),
        0,
      );

      const collapsedWidth = SIDEBAR_ROW_INSET_PX * 2 + NAV_ICON_WIDTH_PX;
      const expandedWidth =
        SIDEBAR_ROW_INSET_PX * 2 + NAV_ICON_WIDTH_PX + NAV_ICON_LABEL_GAP_PX + widestNavTitle;

      const root = document.documentElement.style;
      root.setProperty("--iorio-sidebar-collapsed-width", `${collapsedWidth}px`);
      root.setProperty("--iorio-sidebar-expanded-width", `${expandedWidth}px`);
    };

    measureAndApply();
    // Re-measure once the real UI font finishes loading — initial
    // measurement can happen against fallback-font metrics, which are
    // narrower/wider than Inter and would under/over-size the rail.
    document.fonts.ready.then(measureAndApply).catch(() => {});
  }, []);

  return (
    <div className="page">
      <aside className="navbar navbar-vertical navbar-expand-lg navbar-dark iorio-sidebar">
        <div className="container-fluid">
          <div className="d-flex align-items-center gap-2 iorio-sidebar-brand-row d-lg-none">
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
            <h1 className="navbar-brand mb-0">
              <BrandMark />
            </h1>
          </div>
          <div className="d-flex align-items-center gap-3 ms-auto d-lg-none">
            <button
              type="button"
              className="btn btn-icon iorio-icon-btn"
              title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={toggleTheme}
            >
              {theme === "light" ? <IconMoon size={20} /> : <IconSun size={20} />}
            </button>
            <button type="button" className="btn btn-icon iorio-icon-btn" title="Log out" onClick={() => void logout()}>
              <IconLogout size={20} />
            </button>
          </div>
          <div className="collapse navbar-collapse" id="sidebar-menu">
            <ul className="navbar-nav">
              {navigationItems.map(({ to, label, icon: Icon, end }, index) => (
                <li className="nav-item" key={to}>
                  <NavLink to={to} end={end} className="nav-link">
                    <span className="nav-link-icon d-md-none d-lg-inline-block flex-shrink-0">
                      <Icon size={20} />
                    </span>
                    <span
                      className="nav-link-title"
                      ref={(el) => {
                        navTitleRefs.current[index] = el;
                      }}
                    >
                      {label}
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <header className="navbar navbar-expand-md navbar-dark d-print-none d-none d-lg-flex iorio-topbar">
        <div className="container-fluid">
          <h1 className="navbar-brand mb-0">
            <BrandMark />
          </h1>
          <div className="ms-auto d-flex align-items-center gap-3">
            <button
              type="button"
              className="btn btn-icon iorio-icon-btn"
              title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={toggleTheme}
            >
              {theme === "light" ? <IconMoon size={20} /> : <IconSun size={20} />}
            </button>
            <button type="button" className="btn btn-icon iorio-icon-btn" title="Log out" onClick={() => void logout()}>
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
