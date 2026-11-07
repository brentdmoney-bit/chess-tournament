import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// NEXT_PUBLIC_ lets the app read the env vars the Vercel ↔ Supabase integration sets.
export default defineConfig({
  plugins: [react(), tailwind()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
