import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Production serves /config.js from server.js; the dev server serves the same script so both use one code path.
function devRuntimeConfig(apiBaseUrl: string | undefined): Plugin {
  return {
    name: 'dev-runtime-config',
    configureServer(server) {
      server.middlewares.use('/config.js', (_request, response) => {
        response.setHeader('Content-Type', 'application/javascript')
        response.end(`window.__RUNTIME_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};\n`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environmentVariables = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), devRuntimeConfig(environmentVariables.VITE_API_BASE_URL)],
    server: {
      port: 3031,
    },
  }
})
