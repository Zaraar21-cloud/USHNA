import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // relative assets: works at a domain root (Vercel/Netlify) or a GitHub Pages subpath
  server: {
    fs: { allow: ['..'] }, // the UI imports trained_models/*.json from the repo root
    port: 3000,
    open: true,
  },
})
