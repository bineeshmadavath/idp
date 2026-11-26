import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev`       -> UI talks to the FastAPI backend on :8000 (proxied /api)
// `npm run dev:mock`  -> UI runs fully in the browser with the built-in mock API
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __MOCK__: JSON.stringify(mode === 'mock'), __PREVIEW__: 'false' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
}))
