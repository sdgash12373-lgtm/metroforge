import { defineConfig, type Plugin } from 'vite';
import { CHANGELOG } from './src/changelog';

/** Writes version.json next to the game, so open tabs can notice a new release. */
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    const { version, title, date } = CHANGELOG[0];
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, title, date }) });
  },
});

// Relative base so the build works from GitHub Pages or any sub-path
export default defineConfig({
  base: './',
  plugins: [versionFile()],
  // The logo is inlined so the single-file build carries it
  build: { target: 'es2022', chunkSizeWarningLimit: 800, assetsInlineLimit: 20000 },
});
