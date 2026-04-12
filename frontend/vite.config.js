import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  // Strip console.* and debugger in production so log statements don't ship
  // to end users or leak internal diagnostic output. Leaves them in dev so
  // we can still debug locally.
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    outDir: 'build',
    // 'hidden' emits .map files (useful for Sentry symbolication uploads) but
    // does NOT reference them from the served JS, so they aren't fetched by
    // browsers in production.
    sourcemap: 'hidden',
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
}));
