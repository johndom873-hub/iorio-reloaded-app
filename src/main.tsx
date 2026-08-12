import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@tabler/core/dist/css/tabler.min.css";
import "@tabler/core/dist/js/tabler.esm.min.js";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
