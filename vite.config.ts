import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is the GitHub Pages project path; adjust if the repo is renamed.
export default defineConfig({
  base: '/UW-Madison_Salaries/',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
});
