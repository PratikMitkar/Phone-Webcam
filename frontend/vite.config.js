import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The backend serves the built app, so one process runs everything.
  build: { outDir: '../backend/src/main/resources/static', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8088' } },
})
