import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../api/client";

export function LoginPage() {
  const { currentUser, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page page-center">
      <div className="container container-tight py-4">
        <div className="text-center mb-4">
          <h1 className="navbar-brand-text">Iorio Reloaded</h1>
        </div>
        <div className="card card-md">
          <div className="card-body">
            <h2 className="h2 text-center mb-4">Login to your account</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  className="form-control"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}
              <div className="form-footer">
                <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
