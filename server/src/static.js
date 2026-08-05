import fs from 'node:fs';
import path from 'node:path';

// Serves the built web app (app/dist, created by `npx expo export -p web`)
// so one server = API + realtime + the web client on a single URL.
// Zero dependencies; SPA fallback to index.html for client-side routes.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function createStatic(rootDir) {
  const root = path.resolve(rootDir);

  // Returns true when it handled the request, false when there is no web
  // build (caller falls through to its default response).
  return function serveStatic(req, res, urlPath) {
    if (!fs.existsSync(path.join(root, 'index.html'))) return false;

    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      rel = '/';
    }
    if (!rel || rel === '/') rel = '/index.html';

    let file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      file = path.join(root, 'index.html'); // traversal attempt -> app shell
    }

    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch {}
    if (!stat || stat.isDirectory()) {
      file = path.join(root, 'index.html'); // SPA fallback
      try {
        stat = fs.statSync(file);
      } catch {
        return false;
      }
    }

    const ext = path.extname(file).toLowerCase();
    const isIndex = file.endsWith(`${path.sep}index.html`);
    const hashed = rel.startsWith('/_expo/') || rel.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': isIndex
        ? 'no-cache'
        : hashed
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
