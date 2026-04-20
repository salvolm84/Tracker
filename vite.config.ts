import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('@mantine/')) {
            return 'mantine'
          }

          if (id.includes('@tabler/icons-react')) {
            return 'tabler-icons'
          }

          if (id.includes('@tauri-apps/api')) {
            return 'tauri-api'
          }

          if (id.includes('dayjs')) {
            return 'dayjs'
          }

          if (id.includes('react')) {
            return 'react-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
  clearScreen: false,
})
