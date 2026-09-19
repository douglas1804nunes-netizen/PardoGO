const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../config');
const { sendText } = require('./response');

function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^([.][.][\/\\])+/, '');
  const absolute = path.join(PUBLIC_DIR, filePath);
  if (!absolute.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Acesso negado.');
  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    return sendText(res, 404, 'Arquivo não encontrado.');
  }
  const ext = path.extname(absolute).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png'
  };
  const cache = ext === '.html' ? 'no-store' : 'public, max-age=3600';
  sendText(res, 200, fs.readFileSync(absolute), types[ext] || 'application/octet-stream', { 'Cache-Control': cache });
}

module.exports = {
  serveStatic
};
