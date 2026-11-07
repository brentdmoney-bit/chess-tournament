import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// Each build gets an id, baked into the bundle and written to /version.json.
// Open tabs poll that file and show a "new version" banner when it changes.
const BUILD_ID = new Date().toISOString();

// NEXT_PUBLIC_ lets the app read the env vars the Vercel ↔ Supabase integration sets.
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    { name: 'version-file', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) }); } },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
