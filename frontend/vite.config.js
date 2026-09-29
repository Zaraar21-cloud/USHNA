import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // relative assets: works at a domain root (Vercel/Netlify) or a GitHub Pages subpath
  // pdf.js worker ships as .mjs; many static servers (Python's among them) send .mjs as text/plain,
  // which browsers refuse for module workers. Emitting it as .js works everywhere.
  build: { rollupOptions: { output: { assetFileNames: (a) => (a.name?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') } } },
  server: {
    fs: { allow: ['..'] }, // the UI imports ushna/ml/artifacts/*.json from the repo root
    port: 3000,
    open: true,
  },
})
