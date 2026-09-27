// Dev-only: serves the popup at http://localhost:4891/ with a fake chrome.* API and sample data,
// so the UI can be checked in a normal browser tab. Not part of the extension.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

createServer(async (req, res) => {
  let path = new URL(req.url, 'http://x').pathname;
  if (path === '/') {
    const html = (await readFile(join(root, 'src/popup.html'), 'utf8'))
      .replace('href="popup.css"', 'href="/src/popup.css"')
      .replace('<script type="module" src="popup.js">', '<script src="/scripts/chrome-stub.js"></script><script type="module" src="/src/popup.js">');
    res.writeHead(200, { 'content-type': 'text/html' }).end(html);
    return;
  }
  try {
    const file = join(root, normalize(path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(4891, () => console.log('popup preview on http://localhost:4891/'));
