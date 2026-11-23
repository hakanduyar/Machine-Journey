import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 3342, strictPort: true },
  preview: { host: '127.0.0.1', port: 3342, strictPort: true },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
