import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export function ProtectedRoute() {
  const { currentUser, isCheckingSession } = useAuth();

  if (isCheckingSession) {
    return (
      <div className="page page-center">
        <div className="spinner-border text-primary" role="status" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
