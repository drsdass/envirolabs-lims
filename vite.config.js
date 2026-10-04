import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// With a database configured, the bundled demo history is swapped for an empty stub:
// production history is loaded from the database at sign-in.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const live = !!env.VITE_SUPABASE_URL;
  return {
    plugins: [react(), live && {
      name: 'stub-demo-history',
      enforce: 'pre',
      resolveId(src, importer) { if (src === './history.js' || src === '../history.js') return this.resolve(src.replace('history.js', 'history.empty.js'), importer, { skipSelf: true }); },
    }].filter(Boolean),
    esbuild: { loader: 'jsx', include: /src\/.*\.jsx?$/, exclude: [] },
    optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
    build: { chunkSizeWarningLimit: 2500 },
  };
});
