import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Spinner } from "../Spinner";

export function ProtectedRoute() {
  const { currentUser, isCheckingSession } = useAuth();

  if (isCheckingSession) {
    return (
      <div className="page page-center">
        <Spinner label="Loading" className="text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
