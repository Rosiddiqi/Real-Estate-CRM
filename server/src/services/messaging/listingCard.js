// Listing cards in threads: a Message of kind 'listing' carries a snapshot of
// the listing in meta.listing (so the card renders even if the listing later
// changes) plus a shareable link in the body the client actually receives.
const crypto = require('node:crypto');
const prisma = require('../../lib/prisma');
const config = require('../../config');
const { HttpError } = require('../../lib/http');

// Same slug scheme as routes/listings.js (POST /api/listings/:id/share).
const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newSlug() {
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return s;
}
async function ensureSlug(listing) {
  if (listing.publicSlug) return listing.publicSlug;
  for (let i = 0; i < 3; i++) {
    try {
      const slug = newSlug();
      await prisma.listing.update({ where: { id: listing.id }, data: { publicSlug: slug } });
      return slug;
    } catch (err) { if (err.code !== 'P2002') throw err; }
  }
  return null;
}

function moneyCompact(n) {
  if (n == null) return null;
  const v = Number(n);
  const trim = (x, d) => { const s = x.toFixed(d); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; };
  if (v >= 1e9) return `$${trim(v / 1e9, 2)}B`;
  if (v >= 1e6) return `$${trim(v / 1e6, 2)}M`;
  if (v >= 1e3) return `$${trim(v / 1e3, 0)}K`;
  return `$${Math.round(v)}`;
}

function addressOf(l) {
  if (!l) return '';
  if (l.hideAddress) return l.buildingName || l.title || `Private residence${l.neighborhood ? `, ${l.neighborhood}` : ''}`;
  const street = [l.street, l.unitNumber ? `#${l.unitNumber}` : null].filter(Boolean).join(' ');
  return street || l.title || l.buildingName || 'Listing';
}

const publicUrl = (slug) => `${String(config.appUrl || '').replace(/\/$/, '')}/api/public/p/${slug}`;

// MLS/feed listings link to their public listing page when we have one;
// everything else links to the agent's private showcase page.
function shareUrl(l) {
  if (!l) return null;
  const external = l.listingUrl && /^https?:\/\//i.test(l.listingUrl) ? l.listingUrl : null;
  if (l.origin === 'feed' && external) return external;
  if (l.publicSlug) return publicUrl(l.publicSlug);
  return external;
}

function snapshot(l) {
  const baths = l.bathsTotal != null ? l.bathsTotal : (l.bathsFull != null ? (l.bathsFull + (l.bathsHalf ? 0.5 * l.bathsHalf : 0)) : null);
  return {
    id: l.id,
    title: l.title || l.headline || null,
    address: addressOf(l),
    neighborhood: l.neighborhood || null,
    city: l.city || null,
    price: l.listPrice ?? l.priceGuide ?? null,
    priceLabel: l.listPrice ? null : (l.priceGuide ? 'Price guide' : 'Price on request'),
    beds: l.beds ?? null,
    baths,
    sqft: l.livingAreaSqft ?? null,
    status: l.status || null,
    origin: l.origin || null,
    heroPhoto: l.heroPhoto || (Array.isArray(l.photoUrls) && l.photoUrls[0]) || null,
    url: shareUrl(l),
    mlsNumber: l.mlsNumber || null,
  };
}

function defaultLine(snap) {
  const bits = [];
  if (snap.price) bits.push(moneyCompact(snap.price));
  const specs = [snap.beds != null ? `${snap.beds} bd` : null, snap.baths != null ? `${snap.baths} ba` : null, snap.sqft ? `${Number(snap.sqft).toLocaleString('en-US')} sq ft` : null].filter(Boolean).join(' · ');
  if (specs) bits.push(specs);
  return `${snap.address}${snap.neighborhood ? `, ${snap.neighborhood}` : ''}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
}

// → { kind:'listing', body, meta:{ listing } }
async function buildListingMessage({ workspaceId, listingId, note }) {
  const l = await prisma.listing.findFirst({ where: { id: listingId, workspaceId } });
  if (!l) return null;
  if (l.origin === 'whisper') throw new HttpError(400, 'Whispers stay private — add it as a pocket listing to share it');
  if (!l.publicSlug && !(l.origin === 'feed' && l.listingUrl)) l.publicSlug = await ensureSlug(l);
  const snap = snapshot(l);
  const text = String(note || '').trim() || defaultLine(snap);
  const body = snap.url && !text.includes(snap.url) ? `${text}\n${snap.url}` : text;
  return { kind: 'listing', body, meta: { listing: snap } };
}

module.exports = { buildListingMessage, snapshot, shareUrl, moneyCompact, addressOf, defaultLine };
