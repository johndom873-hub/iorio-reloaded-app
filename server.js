import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { announceStartToApi } from "./announceStartToApi.js";

function requireEnvironmentVariable(variableName) {
  const value = process.env[variableName];
  if (!value) {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }
  return value;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(__dirname, "dist");

const app = express();

// The API URL is served at runtime, not baked into the bundle, so the same build works in every environment.
const runtimeConfigScript = `window.__RUNTIME_CONFIG__ = ${JSON.stringify({ apiBaseUrl: requireEnvironmentVariable("VITE_API_BASE_URL") })};\n`;
app.get("/config.js", (_request, response) => {
  response.type("application/javascript").set("Cache-Control", "no-store").send(runtimeConfigScript);
});

app.use(express.static(distDirectory));

// SPA fallback — react-router-dom handles routing client-side. Deliberately
// path-less middleware, not app.get("*", ...): Express 5's path-to-regexp
// no longer accepts a bare "*" wildcard and throws at startup.
app.use((_request, response) => {
  response.sendFile(path.join(distDirectory, "index.html"));
});

const port = Number(requireEnvironmentVariable("PORT"));
app.listen(port, () => {
  console.log(`Iorio Reloaded frontend listening on port ${port}`);
  void announceStartToApi();
});
