#!/usr/bin/env node
/*
 * App Store Connect API helper for scripts/ios/deploy-testflight.sh
 * (ported from RevMatch's scripts/asc-profile.js, plus two preflight modes).
 *
 *   asc-profile.js ensure-bundle <bundleId> [name]
 *       Registers the explicit iOS bundle ID in the developer account if it
 *       doesn't exist yet. Prints BUNDLE_RESOURCE_ID=<id>.
 *   asc-profile.js check-app <bundleId>
 *       Verifies an App Store Connect app record exists for the bundle ID
 *       (Apple's API cannot create one — it's a one-time manual step).
 *       Exit 2 with instructions when it's missing. Prints APP_ID=<id>.
 *   asc-profile.js <bundleId> <distCertSHA1> <outProfilePath>
 *       Creates + writes an IOS_APP_STORE provisioning profile embedding the
 *       distribution certificate whose private key is in this Mac's keychain.
 *       Prints PROFILE_NAME=<name> (the caller captures it).
 *
 * Dependency-free: Node built-in `crypto` (ES256 JWT) + global `fetch` (Node 18+).
 * Env: ASC_API_KEY_ID, ASC_API_ISSUER_ID, ASC_API_KEY_PATH.
 * Diagnostics go to stderr; machine-readable results to stdout.
 */
const crypto = require('crypto');
const fs = require('fs');

const KEY_ID = process.env.ASC_API_KEY_ID;
const ISSUER = process.env.ASC_API_ISSUER_ID;
const KEY_PATH = process.env.ASC_API_KEY_PATH;
const API = 'https://api.appstoreconnect.apple.com/v1';
// CI-created profiles carry this prefix and are pruned each run. It must stay
// distinct from RevMatch's prefix so the two apps never delete each other's.
const NAME_PREFIX = 'KeyMatch AppStore CI';

function die(msg, code = 1) { console.error('asc-profile: ' + msg); process.exit(code); }
if (!KEY_ID || !ISSUER || !KEY_PATH) die('missing ASC_API_KEY_ID / ASC_API_ISSUER_ID / ASC_API_KEY_PATH (set them in ~/.revmatch-deploy.env or ~/.keymatch-deploy.env)');
if (!fs.existsSync(KEY_PATH)) die(`ASC API key not found at ${KEY_PATH}`);

function jwt() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  // dsaEncoding:'ieee-p1363' yields the raw R||S signature JWS/ES256 requires.
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${sig}`;
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + jwt(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function findBundle(identifier) {
  const b = await api('GET', `/bundleIds?filter%5Bidentifier%5D=${encodeURIComponent(identifier)}&limit=10`);
  if (b.status !== 200) die(`bundleIds GET ${b.status}: ${b.text.slice(0, 300)}`);
  // filter[identifier] is a prefix match — require the exact identifier.
  return (b.json.data || []).find((x) => x.attributes.identifier === identifier) || null;
}

async function ensureBundle(identifier, name) {
  let bundle = await findBundle(identifier);
  if (!bundle) {
    const created = await api('POST', '/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier, name: (name || 'KeyMatch').replace(/[^A-Za-z0-9 ]/g, ''), platform: 'IOS' } },
    });
    if (created.status !== 201) die(`bundleIds POST ${created.status}: ${created.text.slice(0, 400)} (need an Admin / App Manager ASC key)`);
    bundle = created.json.data;
    console.error(`asc-profile: registered bundle ID ${identifier} (${bundle.id})`);
  } else {
    console.error(`asc-profile: bundle ID ${identifier} already registered (${bundle.id})`);
  }
  process.stdout.write(`BUNDLE_RESOURCE_ID=${bundle.id}\n`);
}

async function checkApp(identifier) {
  const r = await api('GET', `/apps?filter%5BbundleId%5D=${encodeURIComponent(identifier)}&limit=10`);
  if (r.status !== 200) die(`apps GET ${r.status}: ${r.text.slice(0, 300)}`);
  const app = (r.json.data || []).find((x) => x.attributes.bundleId === identifier);
  if (!app) {
    die([
      `no App Store Connect app record for ${identifier} yet. One-time setup (Apple's API can't do this):`,
      '  1. https://appstoreconnect.apple.com → Apps → "+" → New App',
      `  2. Platform iOS · Name "KeyMatch" (must be unique on the App Store — e.g. "KeyMatch CRM" if taken)`,
      `     Primary language English (U.S.) · Bundle ID ${identifier} · SKU keymatch-ios · Full access`,
      '  3. Re-run this script.',
    ].join('\n'), 2);
  }
  console.error(`asc-profile: app record found — ${app.attributes.name} (${app.id})`);
  process.stdout.write(`APP_ID=${app.id}\n`);
}

async function createProfile(identifier, certSha1, outPath) {
  const bundle = await findBundle(identifier);
  if (!bundle) die(`bundle ${identifier} not found in account (run: asc-profile.js ensure-bundle ${identifier})`);

  // Account distribution cert matching the LOCAL identity's SHA-1 (guarantees
  // we reference the cert whose private key we actually hold).
  const c = await api('GET', '/certificates?filter%5BcertificateType%5D=DISTRIBUTION&limit=200');
  if (c.status !== 200) die(`certificates GET ${c.status}: ${c.text.slice(0, 300)}`);
  const want = certSha1.toUpperCase().replace(/[^0-9A-F]/g, '');
  const cert = (c.json.data || []).find((x) =>
    crypto.createHash('sha1').update(Buffer.from(x.attributes.certificateContent, 'base64')).digest('hex').toUpperCase() === want);
  if (!cert) die(`no account DISTRIBUTION cert matches local SHA-1 ${want} (is the Apple Distribution cert+key in the keychain registered to this account?)`);

  // Best-effort prune of prior KeyMatch CI profiles so they don't accumulate.
  const list = await api('GET', '/profiles?limit=200');
  if (list.status === 200) {
    for (const p of (list.json.data || [])) {
      if ((p.attributes.name || '').startsWith(NAME_PREFIX)) {
        try { await api('DELETE', `/profiles/${p.id}`); } catch (_) { /* ignore */ }
      }
    }
  }

  // Timestamped name avoids duplicate-name 409s.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${NAME_PREFIX} ${stamp}`;
  const create = await api('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: { name, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: [{ type: 'certificates', id: cert.id }] },
      },
    },
  });
  if (create.status !== 201) die(`profile POST ${create.status}: ${create.text.slice(0, 400)} (need an Admin ASC key with Cert/IDs/Profiles access)`);
  const attr = create.json.data.attributes;
  fs.writeFileSync(outPath, Buffer.from(attr.profileContent, 'base64'));
  console.error(`asc-profile: created '${attr.name}' (uuid ${attr.uuid}) cert=${cert.id} bundle=${bundle.id}`);
  process.stdout.write(`PROFILE_NAME=${attr.name}\n`);
}

(async () => {
  const [, , cmd, a, b, c] = process.argv;
  if (cmd === 'ensure-bundle') {
    if (!a) die('usage: asc-profile.js ensure-bundle <bundleId> [name]');
    return ensureBundle(a, b);
  }
  if (cmd === 'check-app') {
    if (!a) die('usage: asc-profile.js check-app <bundleId>');
    return checkApp(a);
  }
  if (!cmd || !a || !b) die('usage: asc-profile.js <bundleId> <distCertSHA1> <outPath> | ensure-bundle <bundleId> [name] | check-app <bundleId>');
  void c;
  return createProfile(cmd, a, b);
})().catch((e) => die((e && e.stack) || String(e)));
