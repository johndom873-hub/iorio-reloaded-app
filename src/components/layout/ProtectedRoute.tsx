import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Spinner } from "../Spinner";

export function ProtectedRoute() {
  const { currentUser, isCheckingSession } = useAuth();

  if (isCheckingSession) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "100vh" }}>
        <Spinner label="Loading" className="text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
