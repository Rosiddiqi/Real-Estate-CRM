// Link previews (iMessage-style OG cards). Only http(s) URLs, behind an SSRF
// guard (no private/loopback/link-local targets, re-checked on every redirect),
// 5s timeout, ≤256KB of HTML, 24h success / 5min failure cache. Offline or
// bot-walled sites degrade to { ok:false } and the client shows a host card.
const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const cache = new Map(); // url -> { at, ttl, value }
const inflight = new Map();

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function assertPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('bad_url'), { reason: 'bad_url' }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('bad_scheme'), { reason: 'bad_scheme' });
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw Object.assign(new Error('blocked_host'), { reason: 'blocked_host' });
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('blocked_ip'), { reason: 'blocked_ip' });
    return u;
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw Object.assign(new Error('dns_failed'), { reason: 'unreachable' }); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('blocked_ip'), { reason: 'blocked_ip' });
  return u;
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

function metaContent(html, names) {
  for (const name of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return decode(m[1]);
  }
  return null;
}

function parseHtml(html, finalUrl) {
  const u = new URL(finalUrl);
  const title = metaContent(html, ['og:title', 'twitter:title']) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
  let image = metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  const siteName = metaContent(html, ['og:site_name', 'application-name']);
  let favicon = null;
  const icon = html.match(/<link[^>]+rel=["'](?:shortcut )?(?:apple-touch-)?icon["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
  try { if (icon) favicon = new URL(decode(icon[1]), u).href; } catch { /* ignore */ }
  try { if (image) image = new URL(image, u).href; } catch { image = null; }
  if (image && !/^https?:/i.test(image)) image = null;
  return {
    url: finalUrl,
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 300) : null,
    image,
    siteName: siteName ? siteName.slice(0, 80) : null,
    host: u.hostname.replace(/^www\./, ''),
    favicon: favicon || `${u.protocol}//${u.host}/favicon.ico`,
  };
}

async function fetchHtml(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(url);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch (err) {
      clearTimeout(t);
      throw Object.assign(new Error('unreachable'), { reason: err.name === 'AbortError' ? 'timeout' : 'unreachable' });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(t);
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    if (!res.ok) { clearTimeout(t); throw Object.assign(new Error(`http_${res.status}`), { reason: `http_${res.status}` }); }
    const type = res.headers.get('content-type') || '';
    if (type.startsWith('image/')) { clearTimeout(t); return { imageOnly: true, url }; }
    if (!/html|xml/i.test(type)) { clearTimeout(t); throw Object.assign(new Error('not_html'), { reason: 'not_html' }); }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size >= MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      }
    } finally { clearTimeout(t); }
    return { html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), url };
  }
  throw Object.assign(new Error('too_many_redirects'), { reason: 'too_many_redirects' });
}

async function getPreview(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (/^www\./i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad_scheme' };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return { ...hit.value, cached: true };
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    try {
      const out = await fetchHtml(url);
      const data = out.imageOnly
        ? { url: out.url, title: null, description: null, image: out.url, siteName: null, host: new URL(out.url).hostname.replace(/^www\./, ''), favicon: null }
        : parseHtml(out.html, out.url);
      const value = { ok: true, data };
      cache.set(url, { at: Date.now(), ttl: 24 * 3600_000, value });
      return value;
    } catch (err) {
      const value = { ok: false, reason: err.reason || 'unreachable' };
      cache.set(url, { at: Date.now(), ttl: 5 * 60_000, value });
      return value;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

module.exports = { getPreview, assertPublicHttpUrl, isPrivateIp, parseHtml };
