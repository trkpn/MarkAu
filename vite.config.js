import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { handleProxyRequest } from './server/proxy-core.js';
import { handleTranscriptRequest } from './server/youtube-transcript.js';
import { handleTranslateRequest } from './server/translate-core.js';

/**
 * Custom Vite Plugin to automatically inject all compiled assets (JS, CSS, fonts, HTML)
 * into dist/sw.js so that the Service Worker serves the whole application offline.
 *
 * Only the files the browser needs for the *first* load are precached. The
 * chunks that are pulled in on demand — the full Highlight.js language set,
 * Mermaid and its diagram parsers — are fetched when they are needed and
 * cached by the service worker at runtime, so they cost nothing until a
 * visitor actually uses them.
 */
function swPrecachePlugin() {
  /** The JS files that are statically reachable from the entry chunk. */
  const state = { firstLoad: null };

  return {
    name: 'sw-precache-plugin',

    /**
     * Walks the chunk graph from the entry and keeps what the first load
     * needs. Everything behind a dynamic import stays out of the precache.
     */
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const entry = chunks.find((chunk) => chunk.isEntry);
      if (!entry) return;

      const reachable = new Set();
      const queue = [entry];

      while (queue.length > 0) {
        const chunk = queue.pop();
        if (!chunk || reachable.has(chunk.fileName)) continue;
        reachable.add(chunk.fileName);

        for (const imported of chunk.imports) {
          const next = chunks.find((candidate) => candidate.fileName === imported);
          if (next) queue.push(next);
        }
      }

      state.firstLoad = reachable;
    },

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
            if (rel.endsWith('sw.js')) continue;

            // A script that is not part of the first load is fetched on
            // demand — precaching it would download megabytes that most
            // visitors never need. The worker of the PDF reader is such a
            // file: it is only wanted when a PDF is read.
            const isLazyScript =
              rel.endsWith('.js') && state.firstLoad && !state.firstLoad.has(rel.slice(1));
            const isLazyWorker = /\/assets\/pdf\.worker-/.test(rel);

            if (!isLazyScript && !isLazyWorker) {
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
          `const CACHE_NAME = 'markau-${buildTimestamp}';`
        );
        swCode = swCode.replace(
          /const STATIC_ASSETS = \[[\s\S]*?\];/,
          `const STATIC_ASSETS = ${JSON.stringify(assetUrls, null, 2)};`
        );
        fs.writeFileSync(swDistPath, swCode, 'utf8');
        console.log(
          `[SW Plugin] Timestamp: markau-${buildTimestamp} with ${assetUrls.length} precache assets injected into dist/sw.js`
        );
      }
    }
  };
}

/**
 * Serves the proxy during development.
 *
 * In production the proxy is a Cloudflare Pages Function. In development
 * there is no function runtime, so the very same core is mounted on the
 * dev server — the behaviour of the two is identical by construction.
 */
function devProxyPlugin() {
  return {
    name: 'dev-proxy-plugin',

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // The address of the server has to be the one the browser used,
        // with the port and all: the endpoints check the origin of a
        // request against their own, and a request without the port is a
        // request from somewhere else.
        const host = req.headers.host || 'localhost';
        const url = new URL(req.url || '/', `http://${host}`);

        const endpoints = {
          '/api/fetch': handleProxyRequest,
          '/api/youtube-transcript': handleTranscriptRequest,
          '/api/translate': handleTranslateRequest
        };

        const handler = endpoints[url.pathname];
        if (!handler) {
          next();
          return;
        }

        try {
          const headers = {};
          for (const name of [
            'origin',
            'referer',
            'user-agent',
            'accept-language',
            'content-type'
          ]) {
            const value = req.headers[name];
            if (value) headers[name] = value;
          }

          // A request that carries a body — the translator is asked with
          // one — has to have the body read and passed on.
          let body;
          if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            body = Buffer.concat(chunks);
          }

          const request = new Request(url, { method: req.method || 'GET', headers, body });
          const response = await handler(request);

          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(await response.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [tailwindcss(), swPrecachePlugin(), devProxyPlugin()],
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
          // The Mermaid loader and the individual diagram parsers are fetched
          // on demand; a recognisable name makes them easy to spot.
          const moduleIds = chunkInfo.moduleIds || [];
          const isMermaid =
            facade.includes('node_modules/mermaid') ||
            moduleIds.some((id) => id.includes('node_modules/mermaid'));
          if (isMermaid) {
            return 'assets/mermaid/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        manualChunks(id) {
          // Mermaid ships its own KaTeX. It must not join the app's chunk:
          // the app loads that one with the first paint, while Mermaid is
          // only needed once a document contains a diagram.
          if (id.includes('node_modules/mermaid') && id.includes('katex')) {
            return 'vendor-mermaid-katex';
          }
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
