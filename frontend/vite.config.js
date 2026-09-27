import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5173 must match CORS_ORIGIN in backend/.env, otherwise the browser blocks the API calls.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
