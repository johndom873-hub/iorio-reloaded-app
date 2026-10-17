import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { BackgroundJobsProvider } from "./contexts/BackgroundJobsContext";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PositionsPage } from "./pages/PositionsPage";
import { SignalsPage } from "./pages/SignalsPage";
import { ShortlistPage } from "./pages/ShortlistPage";
import { PricePerformancePage } from "./pages/PricePerformancePage";
import { TradeBlotterPage } from "./pages/TradeBlotterPage";
import { RiskLimitsPage } from "./pages/RiskLimitsPage";
import { PlutoPage } from "./pages/PlutoPage";
import { SystemHealthPage } from "./pages/SystemHealthPage";
import { CalendarEventsPage } from "./pages/CalendarEventsPage";
import { PulsePage } from "./pages/PulsePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { Spinner } from "./components/Spinner";

// Backtesting runs only on the Mac with the ThetaData files: its screens exist in dev builds only. Behind the
// import.meta.env.DEV check, a production build drops the routes and never emits the pages' code.
const BacktestPage = import.meta.env.DEV ? lazy(() => import("./pages/backtest/BacktestPage").then((module) => ({ default: module.BacktestPage }))) : null;
const NewBacktestSessionPage = import.meta.env.DEV ? lazy(() => import("./pages/backtest/NewBacktestSessionPage").then((module) => ({ default: module.NewBacktestSessionPage }))) : null;
const BacktestSessionPage = import.meta.env.DEV ? lazy(() => import("./pages/backtest/BacktestSessionPage").then((module) => ({ default: module.BacktestSessionPage }))) : null;
const BacktestComparePage = import.meta.env.DEV ? lazy(() => import("./pages/backtest/BacktestComparePage").then((module) => ({ default: module.BacktestComparePage }))) : null;
const BacktestBatchPage = import.meta.env.DEV ? lazy(() => import("./pages/backtest/BacktestBatchPage").then((module) => ({ default: module.BacktestBatchPage }))) : null;

/** A Backtesting screen: loaded on first visit, wrapped in .backtest-screen (theme.css: phone tap targets). */
function BacktestScreen({ children }: { children: ReactNode }) {
  return (
    <div className="backtest-screen">
      <Suspense
        fallback={
          <div className="d-flex justify-content-center py-5">
            <Spinner label="Loading" />
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <BackgroundJobsProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                {/* Full-bleed, chromeless — deliberately a sibling of the
                    AppLayout-wrapped block below, not nested in it, so it
                    still gets auth-gating without the sidebar/topbar. */}
                <Route path="/pulse" element={<PulsePage />} />
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/positions" element={<PositionsPage />} />
                  <Route path="/signals" element={<SignalsPage />} />
                  <Route path="/shortlist" element={<ShortlistPage />} />
                  <Route path="/price-performance" element={<PricePerformancePage />} />
                  <Route path="/trade-blotter" element={<TradeBlotterPage />} />
                  <Route path="/risk-limits" element={<RiskLimitsPage />} />
                  <Route path="/pluto" element={<PlutoPage />} />
                  <Route path="/system-health" element={<SystemHealthPage />} />
                  <Route path="/calendar" element={<CalendarEventsPage />} />
                  {BacktestPage && <Route path="/backtest" element={<BacktestScreen><BacktestPage /></BacktestScreen>} />}
                  {NewBacktestSessionPage && <Route path="/backtest/new" element={<BacktestScreen><NewBacktestSessionPage /></BacktestScreen>} />}
                  {BacktestSessionPage && <Route path="/backtest/sessions/:sessionId" element={<BacktestScreen><BacktestSessionPage /></BacktestScreen>} />}
                  {BacktestComparePage && <Route path="/backtest/compare" element={<BacktestScreen><BacktestComparePage /></BacktestScreen>} />}
                  {BacktestBatchPage && <Route path="/backtest/batches/:batchId" element={<BacktestScreen><BacktestBatchPage /></BacktestScreen>} />}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </BackgroundJobsProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
