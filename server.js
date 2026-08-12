import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

app.use(express.static(distDirectory));

// SPA fallback — react-router-dom handles routing client-side.
app.get("*", (_request, response) => {
  response.sendFile(path.join(distDirectory, "index.html"));
});

const port = Number(requireEnvironmentVariable("PORT"));
app.listen(port, () => {
  console.log(`Iorio Reloaded frontend listening on port ${port}`);
});
