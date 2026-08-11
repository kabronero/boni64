// Tiny Node server: serves static files with no-cache and exposes a JSON
// scores API. Usage: node server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 8765;
const HOST = process.env.HOST || '0.0.0.0';
// Railway's ephemeral filesystem will reset scores on redeploy; if a volume is
// mounted via the DATA_DIR env var, persist there instead.
const DATA_DIR = process.env.DATA_DIR || ROOT;
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb':  'model/gltf-binary',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
};

function loadScores() {
  try { return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); }
  catch { return []; }
}
function saveScores(s) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(s, null, 2));
}
function sortForGame(scores, game) {
  if (game === 'cocacola') {
    // Only full-wins count; lower seconds is better.
    return scores.filter(s => s.won).sort((a, b) => a.seconds - b.seconds);
  }
  // Default (cookies): more cookies first, then lower seconds.
  return [...scores].sort((a, b) => (b.cookies - a.cookies) || (a.seconds - b.seconds));
}

function setHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/scores') {
    const game = (url.searchParams.get('game') || 'cookies').slice(0, 32);
    if (req.method === 'GET') {
      const filtered = loadScores().filter(s => (s.game || 'cookies') === game);
      const top = sortForGame(filtered, game).slice(0, 10);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(top));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        try {
          const entry = JSON.parse(body);
          if (typeof entry.name !== 'string' || typeof entry.seconds !== 'number') {
            res.writeHead(400); res.end('invalid entry'); return;
          }
          const cleaned = {
            game,
            name: entry.name.trim().slice(0, 16) || 'ANON',
            cookies: Math.max(0, Math.floor(entry.cookies || 0)),
            total:   Math.max(0, Math.floor(entry.total   || 0)),
            seconds: Math.max(0, Math.round(entry.seconds * 10) / 10),
            won: !!entry.won,
            ts: Date.now(),
          };
          const scores = loadScores();
          scores.push(cleaned);
          saveScores(scores);
          const filtered = scores.filter(s => (s.game || 'cookies') === game);
          const sortedAll = sortForGame(filtered, game);
          const rank = sortedAll.indexOf(cleaned);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ rank, top: sortedAll.slice(0, 10) }));
        } catch {
          res.writeHead(400); res.end('bad json');
        }
      });
      return;
    }
  }

  // Static file
  const p = url.pathname;
  let filePath = path.resolve(ROOT, '.' + p);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  // Directory (or bare "/") -> index.html inside it, so /viewer/ works too.
  if (p.endsWith('/') || (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.writeHead(200);
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`boni64 server on http://${HOST}:${PORT}`);
});
