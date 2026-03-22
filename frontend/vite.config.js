import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-ui': ['@radix-ui/react-tabs', '@radix-ui/react-select', '@radix-ui/react-dialog', '@radix-ui/react-popover'],
          'vendor-charts': ['recharts'],
          'vendor-date': ['date-fns'],
        }
      }
    }
  }
});
