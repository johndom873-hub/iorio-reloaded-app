import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/roboto-mono/500.css";
import "@tabler/core/dist/css/tabler.min.css";
import "@tabler/core/dist/js/tabler.esm.min.js";
import "./theme.css";
import App from "./App.tsx";

// React's development build records every re-render whose props changed on the Performance timeline (performance.measure,
// with a diff of the props) and never clears it: a screen that re-renders large props on each poll holds gigabytes until
// reloaded. A Performance panel recording keeps what it captured. Production React records nothing.
const developmentTimelineClearIntervalMilliseconds = 30_000;
if (import.meta.env.DEV) window.setInterval(() => performance.clearMeasures(), developmentTimelineClearIntervalMilliseconds);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
