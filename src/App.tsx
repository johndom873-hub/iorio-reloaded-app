import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { BackgroundJobsProvider } from "./contexts/BackgroundJobsContext";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PositionsPage } from "./pages/PositionsPage";
import { TradeAlertsPage } from "./pages/TradeAlertsPage";
import { ScreenerPage } from "./pages/ScreenerPage";
import { PricePerformancePage } from "./pages/PricePerformancePage";
import { TradeBlotterPage } from "./pages/TradeBlotterPage";
import { RiskLimitsPage } from "./pages/RiskLimitsPage";
import { SystemHealthPage } from "./pages/SystemHealthPage";
import { CalendarEventsPage } from "./pages/CalendarEventsPage";

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <BackgroundJobsProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/positions" element={<PositionsPage />} />
                  <Route path="/trade-alerts" element={<TradeAlertsPage />} />
                  <Route path="/screener" element={<ScreenerPage />} />
                  <Route path="/price-performance" element={<PricePerformancePage />} />
                  <Route path="/trade-blotter" element={<TradeBlotterPage />} />
                  <Route path="/risk-limits" element={<RiskLimitsPage />} />
                  <Route path="/system-health" element={<SystemHealthPage />} />
                  <Route path="/calendar" element={<CalendarEventsPage />} />
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
