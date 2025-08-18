// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite-devserver med proxy till lokala Azure Functions (7071)
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7071',
        changeOrigin: true
      }
    }
  }
})
