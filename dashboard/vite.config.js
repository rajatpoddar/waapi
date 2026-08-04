import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies API calls to the FastAPI backend (:2728) and the
// admin-api webhook proxy. Production builds are served by FastAPI itself
// at /admin (no separate server needed).
export default defineConfig({
  plugins: [react()],
  // The dashboard is served by FastAPI under /admin, so built assets must
  // reference /admin/... paths (otherwise they 404 and the page is blank).
  base: '/admin/',
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:2728',
      '/status': 'http://localhost:2728',
      '/sessions': 'http://localhost:2728',
      '/contacts': 'http://localhost:2728',
      '/send-text': 'http://localhost:2728',
      '/admin-api': 'http://localhost:2728',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
