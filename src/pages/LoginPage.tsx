import { PublicEnvironmentBadges } from "../components/layout/EnvironmentBadges";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { ApiError } from "../api/client";
import { type AuthConfig, fetchAuthConfig } from "../api/auth";
import { describePasskeyError, passkeysSupported, registerPasskey } from "../api/passkeys";
import { Spinner } from "../components/Spinner";

type LoginStage = "passkey" | "password" | "enroll" | "enrolled";

export function LoginPage() {
  const { currentUser, login, loginWithPasskey } = useAuth();
  const { theme } = useTheme();
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [stage, setStage] = useState<LoginStage>("passkey");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAuthConfig()
      .then(setAuthConfig)
      .catch((error) => setConfigError(error instanceof ApiError ? error.message : "Could not reach the server. Please try again."));
  }, []);

  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  // Runs one login step, showing its error (if any) and the spinner on whichever button started it.
  async function runStep(step: () => Promise<void>, describeError: (error: unknown) => string) {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await step();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const describeApiError = (error: unknown) => (error instanceof ApiError ? error.message : "Something went wrong. Please try again.");

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    void runStep(async () => {
      const outcome = await login(username, password);
      if (outcome === "passkey_enrollment_required") {
        setPassword("");
        setStage("enroll");
      }
    }, describeApiError);
  }

  function handlePasskeySignIn() {
    void runStep(loginWithPasskey, describePasskeyError);
  }

  function handleCreatePasskey() {
    void runStep(async () => {
      await registerPasskey();
      setStage("enrolled");
    }, describePasskeyError);
  }

  function showStage(nextStage: LoginStage) {
    setErrorMessage(null);
    setStage(nextStage);
  }

  const submitButtonContent = (label: string) => (
    <>
      {isSubmitting && <Spinner size="sm" />}
      {label}
    </>
  );
  const buttonClassName = "btn btn-primary w-100 py-3 d-inline-flex align-items-center justify-content-center gap-1";

  const passwordForm = (submitLabel: string) => (
    <form onSubmit={handlePasswordSubmit}>
      <div className="mb-3">
        <label className="form-label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          type="text"
          className="form-control"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
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
        <button type="submit" className={buttonClassName} disabled={isSubmitting}>
          {submitButtonContent(submitLabel)}
        </button>
      </div>
    </form>
  );

  const passkeyButton = (
    <div className="form-footer">
      <button type="button" className={buttonClassName} onClick={handlePasskeySignIn} disabled={isSubmitting}>
        {submitButtonContent("Sign in with passkey")}
      </button>
    </div>
  );

  const errorAlert = errorMessage && <div className="alert alert-danger">{errorMessage}</div>;

  function renderCardBody() {
    if (configError) {
      return <div className="alert alert-danger mb-0">{configError}</div>;
    }
    if (!authConfig) {
      return (
        <div className="text-center py-3">
          <Spinner label="Loading" />
        </div>
      );
    }
    if (!authConfig.passkeyLoginRequired) {
      return (
        <>
          <h2 className="h2 text-center mb-4">Login to your account</h2>
          {passwordForm("Sign in")}
        </>
      );
    }
    if (!passkeysSupported()) {
      return <div className="alert alert-danger mb-0">This browser does not support passkeys. Use a current version of Chrome, Safari, Edge or Firefox.</div>;
    }
    switch (stage) {
      case "password":
        return (
          <>
            <h2 className="h2 text-center mb-2">Set up your passkey</h2>
            <p className="text-secondary text-center mb-4">Enter your password once. You will then create a passkey, and use that to sign in from now on.</p>
            {passwordForm("Continue")}
            <div className="text-center mt-3">
              <button type="button" className="btn btn-link text-secondary py-3" onClick={() => showStage("passkey")}>
                Back to passkey sign-in
              </button>
            </div>
          </>
        );
      case "enroll":
        return (
          <>
            <h2 className="h2 text-center mb-2">Create your passkey</h2>
            <p className="text-secondary text-center mb-4">
              Your passkey replaces your password at sign-in. Your browser will ask where to save it: use Touch ID / iCloud Keychain or your password manager.
            </p>
            {errorAlert}
            <div className="form-footer">
              <button type="button" className={buttonClassName} onClick={handleCreatePasskey} disabled={isSubmitting}>
                {submitButtonContent("Create passkey")}
              </button>
            </div>
          </>
        );
      case "enrolled":
        return (
          <>
            <h2 className="h2 text-center mb-2">Passkey created</h2>
            <div className="alert alert-success">Now sign in with it once to confirm it works.</div>
            {errorAlert}
            {passkeyButton}
          </>
        );
      default:
        return (
          <>
            <h2 className="h2 text-center mb-2">Sign in</h2>
            <p className="text-secondary text-center mb-4">Use the passkey saved on this device or in your password manager.</p>
            {errorAlert}
            {passkeyButton}
            <div className="text-center mt-3">
              <button type="button" className="btn btn-link text-secondary py-3" onClick={() => showStage("password")}>
                First time, or lost your passkey?
              </button>
            </div>
          </>
        );
    }
  }

  return (
    <div className="page page-center">
      <div className="container container-tight py-4">
        <div className="text-center mb-4">
          <img
            src={theme === "dark" ? "/brand/iorio-lockup-dark.png" : "/brand/iorio-lockup-light.png"}
            alt="Iorio Reloaded"
            className="img-fluid"
            style={{ maxWidth: "20rem" }}
          />
        </div>
        <div className="mb-3">
          <PublicEnvironmentBadges />
        </div>
        <div className="card card-md">
          <div className="card-body">{renderCardBody()}</div>
        </div>
      </div>
    </div>
  );
}
