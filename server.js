const express = require('express');
const http    = require('http');
const https   = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──────────────────────────────────────────────────────────────────────────────────
const UPSTREAM_STREAM = process.env.STREAM_URL
  || 'https://video1.getstreamhosting.com:2000/public/8288-4';
const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN || '*';

// ── CORS helper ───────────────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
}

// ── Stream proxy ──────────────────────────────────────────────────────────────────────────
app.get('/stream', (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  const upstreamUrl = new URL(UPSTREAM_STREAM);
  const lib = upstreamUrl.protocol === 'https:' ? https : http;
  const options = {
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? 443 : 80),
    path: upstreamUrl.pathname + upstreamUrl.search,
    headers: { 'User-Agent': 'ArthouseAM-Proxy/1.0', 'Icy-MetaData': '1' },
  };
  const upstream = lib.request(options, (upstreamRes) => {
    res.writeHead(200, {
      'Content-Type': upstreamRes.headers['content-type'] || 'audio/mpeg',
      'icy-name': upstreamRes.headers['icy-name'] || 'Arthouse AM',
      'icy-genre': upstreamRes.headers['icy-genre'] || '',
      'icy-metaint': upstreamRes.headers['icy-metaint'] || '',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    });
    upstreamRes.pipe(res);
    req.on('close', () => { upstream.destroy(); });
  });
  upstream.on('error', (err) => {
    console.error('Stream proxy error:', err.message);
    if (!res.headersSent) { res.status(502).json({ error: 'Stream unavailable' }); }
  });
  upstream.end();
});

// ── Now Playing metadata ──────────────────────────────────────────────────────────────────
app.get('/now-playing', async (req, res) => {
  setCors(res);
  try {
    const data = await new Promise((resolve, reject) => {
      const r = https.get(
        'https://video1.getstreamhosting.com:2000/AudioPlayer/8288-4/playerInfo',
        { headers: { 'User-Agent': 'ArthouseAM-Meta/1.0' }, timeout: 5000 },
        (resp) => {
          let b = '';
          resp.on('data', c => b += c);
          resp.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
        }
      );
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    });
    res.json({ title: data.nowplaying || null, artist: null, listeners: data.connections || 0, server: 'Arthouse AM' });
  } catch (err) {
    console.error('Now-playing error:', err.message);
    res.status(502).json({ title: null, artist: null, error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }));

// ── Start ───────────────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Arthouse AM stream server running on port ${PORT}`);
});
