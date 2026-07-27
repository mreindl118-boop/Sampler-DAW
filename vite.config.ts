import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app works from any static host, file://, Capacitor and Electron
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2020' },
  server: { host: true },
})
