// Zero-dependency HTTP server.
//
// Node's built-in http module only: nothing to install, nothing that can fail
// at an offline demo. Every response is computed from the local file.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './config.js';
import { ROUTES } from './routes.js';
import { DatasetMissingError, DatasetInvalidError, datasetPaths, datasetPresent } from './load.js';

// The interface is served from this same origin, so the Service Worker's scope
// covers both the app shell and /api/*. That is what lets a reload with no
// network render the last known measurements instead of a browser error page.
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  // normalize + prefix check keeps ../ out of the served tree
  const target = join(WEB_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(WEB_DIR) || !existsSync(target)) return false;

  const body = await readFile(target);
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    // The Service Worker owns caching; the network copy must never be stale.
    'Cache-Control': 'no-cache',
    // Allow the worker to control the whole origin from /sw.js
    ...(target.endsWith('sw.js') ? { 'Service-Worker-Allowed': '/' } : {})
  });
  res.end(body);
  return true;
}

function matchRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const rp = route.pattern.split('/').filter(Boolean);
    const ap = pathname.split('/').filter(Boolean);
    if (rp.length !== ap.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(ap[i]);
      else if (rp[i] !== ap[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') return send(res, 204, {});

    if (url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        dataset_present: datasetPresent(),
        expected_paths: datasetPaths()
      });
    }

    const match = matchRoute(req.method, url.pathname);
    if (!match) {
      // Anything that is not an API route may be a file in web/.
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        try {
          if (await serveStatic(req, res, url.pathname)) return;
        } catch (e) {
          console.error('[static]', e);
        }
      }
      return send(res, 404, {
        error: 'no such endpoint',
        endpoints: ROUTES.map((r) => `${r.method} ${r.pattern}`)
      });
    }

    const query = Object.fromEntries(url.searchParams.entries());

    let body = null;
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : null;
      } catch (e) {
        return send(res, 400, { error: `invalid JSON body: ${e.message}` });
      }
    }

    try {
      const { status, body: out } = await match.route.handler(match.params, query, body);
      return send(res, status, out);
    } catch (e) {
      // The dataset being absent is a configuration fact, not a bug. It gets
      // its own status and a message that says exactly what to do — and the
      // service still refuses to invent a substitute.
      if (e instanceof DatasetMissingError) {
        return send(res, 503, {
          error: 'dataset_missing',
          message: e.message,
          expected_paths: datasetPaths()
        });
      }
      if (e instanceof DatasetInvalidError) {
        return send(res, 500, { error: 'dataset_invalid', message: e.message });
      }
      console.error('[unhandled]', e);
      return send(res, 500, { error: 'internal_error', message: e.message });
    }
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const server = createApp();
  server.listen(PORT, () => {
    console.log(`almaty-pollen-api listening on http://localhost:${PORT}`);
    if (!datasetPresent()) {
      const p = datasetPaths();
      console.warn(
        '\n  WARNING: no measurement file found.\n' +
          `  Expected ${p.json}\n` +
          `        or ${p.csv}\n` +
          '  Every data endpoint will return 503 until it is present.\n' +
          '  This service has no mock mode by design.\n'
      );
    }
  });
}
