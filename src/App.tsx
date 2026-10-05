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
