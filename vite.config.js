import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Custom Vite Plugin to automatically inject all compiled assets (JS, CSS, fonts, HTML)
 * into dist/sw.js so that the Service Worker precaches 100% of the application offline.
 */
function swPrecachePlugin() {
  return {
    name: 'sw-precache-plugin',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) return;

      const getAllFiles = (dir, fileList = []) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            getAllFiles(fullPath, fileList);
          } else {
            const rel = '/' + path.relative(distDir, fullPath).replace(/\\/g, '/');
            // The optional language set is fetched on demand — precaching it
            // would download ~800 kB that most visitors never need.
            const isLazyChunk = /highlight-all/.test(rel);
            if (!rel.endsWith('sw.js') && !isLazyChunk) {
              fileList.push(rel);
            }
          }
        }
        return fileList;
      };

      const assetUrls = Array.from(new Set(['/', ...getAllFiles(distDir)]));
      const swDistPath = path.join(distDir, 'sw.js');

      if (fs.existsSync(swDistPath)) {
        const buildTimestamp = Date.now();
        let swCode = fs.readFileSync(swDistPath, 'utf8');
        swCode = swCode.replace(
          /const CACHE_NAME = [^;\n]+;/,
          `const CACHE_NAME = 'markaudio-${buildTimestamp}';`
        );
        swCode = swCode.replace(
          /const STATIC_ASSETS = \[[\s\S]*?\];/,
          `const STATIC_ASSETS = ${JSON.stringify(assetUrls, null, 2)};`
        );
        fs.writeFileSync(swDistPath, swCode, 'utf8');
        console.log(
          `[SW Plugin] Timestamp: markaudio-${buildTimestamp} with ${assetUrls.length} precache assets injected into dist/sw.js`
        );
      }
    }
  };
}

export default defineConfig({
  plugins: [tailwindcss(), swPrecachePlugin()],
  server: {
    port: 5173,
    open: false
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // The lazily loaded language set gets a recognisable name so the
        // service worker can leave it out of the precache.
        chunkFileNames(chunkInfo) {
          const facade = chunkInfo.facadeModuleId || '';
          if (facade.includes('highlight.js')) {
            return 'assets/highlight-all-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        manualChunks(id) {
          if (id.includes('katex')) {
            return 'vendor-katex';
          }
          // highlight.js is deliberately NOT pinned to a chunk: the common
          // language set is imported statically, while the full set is loaded
          // on demand. Forcing both into one chunk would ship the full set
          // to every visitor.
          if (id.includes('markdown-it') || id.includes('dompurify')) {
            return 'vendor-markdown';
          }
        }
      }
    }
  }
});
