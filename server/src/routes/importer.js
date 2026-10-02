// /api/import — bring a book of clients in from a CSV / vCard export.
// The browser parses the file (CSV · TSV · VCF) and sends headers + rows;
// the server maps columns (AI-assisted, header-name heuristic fallback) and
// imports in chunks so the UI can show real progress.
//
//   POST /api/import/analyze { fileName, format, headers:[…], sample:[[…]], totalRows } → { job, mapping, confidence, fields, source }
//   POST /api/import/execute { jobId, rows:[{field:value}], onDuplicate:'update'|'skip', final } → { created, updated, skipped, errors, job }
//   GET  /api/import/jobs → { jobs }
const express = require('express');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const ai = require('../ai/claude');
const { ah, HttpError } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { logActivity } = require('../lib/activity');
const S = require('../services/clients/serialize');
const { parseMoneyRE } = require('../services/clients/text');

const router = express.Router();

const FIELDS = [
  { key: 'fullName', label: 'Full name', syn: ['name', 'full name', 'fullname', 'contact', 'contact name', 'display name', 'client', 'client name', 'customer', 'formatted name'] },
  { key: 'firstName', label: 'First name', syn: ['first', 'first name', 'firstname', 'given name', 'givenname', 'fname'] },
  { key: 'lastName', label: 'Last name', syn: ['last', 'last name', 'lastname', 'surname', 'family name', 'lname'] },
  { key: 'phone', label: 'Mobile phone', syn: ['phone', 'mobile', 'cell', 'mobile phone', 'cell phone', 'phone number', 'primary phone', 'phone 1 value', 'telephone', 'tel', 'phone mobile', 'cellular'] },
  { key: 'phoneAlt', label: 'Other phone', syn: ['home phone', 'work phone', 'other phone', 'phone 2 value', 'office phone', 'business phone', 'landline'] },
  { key: 'email', label: 'Email', syn: ['email', 'e mail', 'email address', 'e mail 1 value', 'primary email', 'mail', 'email 1'] },
  { key: 'emailAlt', label: 'Other email', syn: ['email 2', 'e mail 2 value', 'other email', 'work email', 'secondary email'] },
  { key: 'company', label: 'Company', syn: ['company', 'organization', 'organization 1 name', 'business', 'employer', 'brokerage', 'firm', 'org'] },
  { key: 'jobTitle', label: 'Job title', syn: ['title', 'job title', 'organization 1 title', 'position', 'role'] },
  { key: 'type', label: 'Client type', syn: ['type', 'client type', 'contact type', 'buyer seller', 'category type'] },
  { key: 'contactKind', label: 'Kind (client/partner/vendor)', syn: ['kind', 'contact kind', 'relationship type'] },
  { key: 'vendorRole', label: 'Vendor / partner role', syn: ['vendor role', 'service', 'profession', 'vendor type', 'partner type'] },
  { key: 'status', label: 'Status', syn: ['status', 'stage', 'lead status'] },
  { key: 'rating', label: 'Rating', syn: ['rating', 'stars', 'priority', 'grade', 'score', 'a b c'] },
  { key: 'leadSource', label: 'Lead source', syn: ['source', 'lead source', 'how did you hear', 'referral source', 'origin', 'channel'] },
  { key: 'tags', label: 'Tags', syn: ['tags', 'labels', 'groups', 'group membership', 'category', 'categories', 'lists'] },
  { key: 'street', label: 'Street', syn: ['address', 'street', 'address 1', 'street address', 'home street', 'address 1 street', 'mailing address', 'address line 1', 'mailing street'] },
  { key: 'city', label: 'City', syn: ['city', 'home city', 'address 1 city', 'mailing city', 'town'] },
  { key: 'state', label: 'State', syn: ['state', 'province', 'region', 'home state', 'address 1 region', 'mailing state'] },
  { key: 'zip', label: 'ZIP', syn: ['zip', 'zip code', 'postal code', 'postcode', 'home postal code', 'address 1 postal code', 'mailing zip'] },
  { key: 'neighborhood', label: 'Neighborhood', syn: ['neighborhood', 'neighbourhood', 'area', 'community', 'subdivision'] },
  { key: 'birthday', label: 'Birthday', syn: ['birthday', 'birth date', 'birthdate', 'dob', 'date of birth', 'bday'] },
  { key: 'spouse', label: 'Spouse / partner', syn: ['spouse', 'partner', 'spouse name', 'significant other', 'husband', 'wife'] },
  { key: 'notes', label: 'Notes', syn: ['notes', 'note', 'comments', 'comment', 'description', 'memo', 'background'] },
  { key: 'ownedAddress', label: 'Owned property address', syn: ['property address', 'owned property', 'home address owned', 'property', 'listing address', 'owns'] },
  { key: 'ownedValue', label: 'Owned property value', syn: ['property value', 'home value', 'estimated value', 'value', 'zestimate'] },
  { key: 'searchAreas', label: 'Search areas', syn: ['areas', 'search areas', 'preferred areas', 'desired neighborhoods', 'target areas', 'looking in'] },
  { key: 'budget', label: 'Budget (max)', syn: ['budget', 'price range', 'max price', 'price max', 'max budget', 'budget max'] },
];
const FIELD_KEYS = new Set(FIELDS.map((f) => f.key));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function heuristicMapping(headers) {
  const mapping = {};
  const confidence = {};
  const used = new Set();
  // exact synonym hits first, then "contains" hits.
  for (const pass of ['exact', 'contains']) {
    headers.forEach((h, i) => {
      if (mapping[i] !== undefined) return;
      const n = norm(h);
      if (!n) return;
      for (const f of FIELDS) {
        if (used.has(f.key) && !['tags', 'notes'].includes(f.key)) continue;
        const hit = pass === 'exact' ? f.syn.includes(n) || norm(f.label) === n : f.syn.some((s) => s.length > 3 && (n.includes(s) || s.includes(n)) && n.length > 2);
        if (hit) { mapping[i] = f.key; confidence[i] = pass === 'exact' ? 0.95 : 0.65; used.add(f.key); break; }
      }
    });
  }
  headers.forEach((h, i) => { if (mapping[i] === undefined) { mapping[i] = null; confidence[i] = 0; } });
  // "Name" alone + first/last present → prefer first/last.
  return { mapping, confidence };
}

async function aiMapping(headers, sample, workspaceId) {
  if (!ai.available()) return null;
  const schema = { type: 'object', properties: { columns: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, field: { type: ['string', 'null'] }, confidence: { type: 'number' } } } } } };
  const system = `You map spreadsheet columns from a real-estate agent's contact export to CRM fields. Allowed fields: ${FIELDS.map((f) => `${f.key} (${f.label})`).join(', ')}. Use null for columns that fit none. Each field at most once (tags and notes may repeat). Never map a column to a field that would store protected-class information (race, religion, national origin, familial status, disability, age, sex) — map those to null.`;
  const prompt = `Columns (index: header → sample values):\n${headers.map((h, i) => `${i}: ${h} → ${sample.slice(0, 4).map((r) => JSON.stringify(String(r[i] ?? '').slice(0, 40))).join(', ')}`).join('\n')}\n\nReturn the mapping JSON.`;
  try {
    const out = await Promise.race([ai.json({ system, prompt, schema, effort: 'low', maxTokens: 3000, feature: 'import_mapping', workspaceId }), new Promise((r) => setTimeout(() => r(null), 25000))]);
    if (!out || !Array.isArray(out.columns)) return null;
    const mapping = {}; const confidence = {};
    for (const c of out.columns) {
      if (!Number.isInteger(c.index) || c.index < 0 || c.index >= headers.length) continue;
      mapping[c.index] = c.field && FIELD_KEYS.has(c.field) ? c.field : null;
      confidence[c.index] = Math.max(0, Math.min(1, Number(c.confidence) || 0.8));
    }
    headers.forEach((h, i) => { if (mapping[i] === undefined) { mapping[i] = null; confidence[i] = 0; } });
    return { mapping, confidence };
  } catch (err) {
    if (err && err.code !== 'ai_unavailable') console.error('[import] AI mapping failed:', err.message);
    return null;
  }
}

router.post('/analyze', ah(async (req, res) => {
  const wid = req.workspaceId;
  const { fileName = 'import.csv', format = 'csv', headers = [], sample = [], totalRows = 0 } = req.body || {};
  if (!Array.isArray(headers) || !headers.length) throw new HttpError(400, 'No columns found in that file.');
  const h = heuristicMapping(headers);
  const a = await aiMapping(headers, Array.isArray(sample) ? sample : [], wid);
  let mapping = h.mapping; let confidence = h.confidence; let source = 'heuristic';
  if (a) {
    // AI wins where it is confident; heuristics keep their exact hits.
    mapping = {}; confidence = {};
    headers.forEach((_, i) => {
      if (h.confidence[i] >= 0.95) { mapping[i] = h.mapping[i]; confidence[i] = h.confidence[i]; }
      else if (a.mapping[i] && a.confidence[i] >= 0.5) { mapping[i] = a.mapping[i]; confidence[i] = a.confidence[i]; }
      else { mapping[i] = h.mapping[i]; confidence[i] = h.confidence[i]; }
    });
    source = 'ai';
  }
  const job = await prisma.importJob.create({ data: { workspaceId: wid, kind: 'clients', fileName: String(fileName).slice(0, 200), status: 'mapping', mapping: { headers, mapping, format, totalRows }, stats: { created: 0, updated: 0, skipped: 0, errors: 0 } } });
  res.json({ job, mapping, confidence, source, fields: FIELDS.map(({ key, label }) => ({ key, label })) });
}));

const TYPE_MAP = { buyer: 'buyer', seller: 'seller', 'buyer seller': 'buyer_seller', both: 'buyer_seller', investor: 'investor', renter: 'renter', tenant: 'renter', landlord: 'landlord', developer: 'developer', sphere: 'sphere', 'past client': 'sphere' };
const KIND_MAP = { client: 'client', partner: 'partner', agent: 'partner', 'co op': 'partner', referral: 'partner', vendor: 'vendor', lender: 'vendor', attorney: 'vendor', inspector: 'vendor', title: 'vendor', stager: 'vendor', photographer: 'vendor' };
const STATUS_MAP = { lead: 'lead', new: 'lead', prospect: 'lead', active: 'active', hot: 'active', 'past client': 'past_client', past: 'past_client', closed: 'past_client', sphere: 'sphere', inactive: 'inactive', dead: 'inactive', cold: 'inactive' };

function clean(v) { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, 2000) : null; }
function normBirthday(v) {
  const s = clean(v); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); if (m) { const y = m[3].length === 2 ? (Number(m[3]) > 30 ? `19${m[3]}` : `20${m[3]}`) : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = /^--(\d{2})-?(\d{2})$/.exec(s); if (m) return `--${m[1]}-${m[2]}`;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function rowToClient(r) {
  const out = {};
  let first = clean(r.firstName); let last = clean(r.lastName);
  if (!first && !last && clean(r.fullName)) {
    const full = clean(r.fullName).replace(/\s+/g, ' ');
    if (full.includes(',')) { const [l, f] = full.split(',').map((x) => x.trim()); first = f; last = l; }
    else { const parts = full.split(' '); first = parts.shift(); last = parts.join(' '); }
  }
  out.firstName = first || ''; out.lastName = last || '';
  const phone = normalizePhone(clean(r.phone) || ''); if (phone && phone.replace(/\D/g, '').length >= 7) out.phone = phone;
  const phoneAlt = normalizePhone(clean(r.phoneAlt) || ''); if (phoneAlt && phoneAlt.replace(/\D/g, '').length >= 7) out.phoneAlt = phoneAlt;
  const email = clean(r.email); if (email && email.includes('@')) out.email = email.toLowerCase();
  const emailAlt = clean(r.emailAlt); if (emailAlt && emailAlt.includes('@')) out.emailAlt = emailAlt.toLowerCase();
  for (const k of ['company', 'jobTitle', 'street', 'city', 'state', 'zip', 'neighborhood', 'leadSource']) { const v = clean(r[k]); if (v) out[k] = v.slice(0, 200); }
  const vr = clean(r.vendorRole); if (vr) out.vendorRole = vr.toLowerCase();
  const t = norm(r.type); if (t && TYPE_MAP[t]) out.type = TYPE_MAP[t];
  const k = norm(r.contactKind || ''); if (k && KIND_MAP[k]) out.contactKind = KIND_MAP[k];
  if (!out.contactKind && out.vendorRole && KIND_MAP[norm(out.vendorRole)]) out.contactKind = KIND_MAP[norm(out.vendorRole)];
  const st = norm(r.status); if (st && STATUS_MAP[st]) out.status = STATUS_MAP[st];
  const rt = clean(r.rating);
  if (rt) { const n = /^[a-c]$/i.test(rt) ? { a: 5, b: 4, c: 3 }[rt.toLowerCase()] : Math.round(Number(String(rt).replace(/[^\d.]/g, ''))); if (Number.isFinite(n) && n >= 0) out.rating = Math.min(5, n); }
  const tags = clean(r.tags); if (tags) out.tags = [...new Set(tags.split(/[;,|]/).map((x) => x.replace(/^\*\s*/, '').trim()).filter((x) => x && x.length <= 60 && !/^my contacts$/i.test(x)))].slice(0, 20);
  const bd = normBirthday(r.birthday); if (bd) out.birthday = bd;
  const spouse = clean(r.spouse); if (spouse) out.personal = { spouse };
  return out;
}

router.post('/execute', ah(async (req, res) => {
  const wid = req.workspaceId;
  const { jobId, rows = [], onDuplicate = 'update', final = false, startIndex = 0 } = req.body || {};
  const job = jobId ? await prisma.importJob.findFirst({ where: { id: jobId, workspaceId: wid } }) : null;
  if (!job) throw new HttpError(404, 'Import job not found — analyze the file first.');
  if (!Array.isArray(rows) || rows.length > 500) throw new HttpError(400, 'Send up to 500 rows per request.');
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 };
  const errors = [];
  const seenKey = new Set((job.stats && job.stats.seen) || []);
  if (job.status !== 'importing') await prisma.importJob.update({ where: { id: job.id }, data: { status: 'importing' } });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const rowNum = startIndex + i + 1;
    try {
      const data = rowToClient(r);
      if (!data.firstName && !data.lastName && !data.company && !data.email) { stats.skipped++; errors.push({ row: rowNum, error: 'No name' }); continue; }
      if (!data.firstName && !data.lastName && data.company) data.displayName = data.company;
      const key = data.phone || data.email || `${data.firstName}|${data.lastName}`.toLowerCase();
      if (seenKey.has(key)) { stats.skipped++; continue; }
      seenKey.add(key);
      const or = [];
      if (data.phone) or.push({ phone: data.phone }, { phoneAlt: data.phone });
      if (data.email) or.push({ email: { equals: data.email, mode: 'insensitive' } });
      const existing = or.length ? await prisma.client.findFirst({ where: { workspaceId: wid, archivedAt: null, OR: or } }) : null;
      let client;
      if (existing) {
        if (onDuplicate === 'skip') { stats.skipped++; continue; }
        const patch = {};
        for (const [k, v] of Object.entries(data)) {
          if (k === 'tags') { const merged = [...new Set([...(existing.tags || []), ...v])]; if (merged.length !== (existing.tags || []).length) patch.tags = merged; continue; }
          if (k === 'personal') { const p = { ...(existing.personal || {}) }; let changed = false; for (const [pk, pv] of Object.entries(v)) if (!p[pk]) { p[pk] = pv; changed = true; } if (changed) patch.personal = p; continue; }
          if (existing[k] == null || existing[k] === '' || (k === 'rating' && !existing.rating)) patch[k] = v;
        }
        client = Object.keys(patch).length ? await prisma.client.update({ where: { id: existing.id }, data: patch }) : existing;
        stats.updated++;
      } else {
        client = await prisma.client.create({ data: { ...data, workspaceId: wid, leadSource: data.leadSource || 'import' } });
        stats.created++;
      }
      const note = clean(r.notes);
      if (note) await prisma.note.create({ data: { workspaceId: wid, clientId: client.id, body: note.slice(0, 5000), source: 'import' } });
      const owned = clean(r.ownedAddress);
      if (owned) {
        const dupeP = await prisma.portfolioProperty.findFirst({ where: { workspaceId: wid, clientId: client.id, street: { equals: owned, mode: 'insensitive' } } });
        if (!dupeP) {
          const p = await prisma.portfolioProperty.create({ data: { workspaceId: wid, clientId: client.id, relationship: 'owns', street: owned.slice(0, 200), city: data.city || null, state: data.state || null, zip: data.zip || null, estValue: parseMoneyRE(clean(r.ownedValue)) || null, valueSource: clean(r.ownedValue) ? 'manual' : null, source: 'manual' } });
          await logActivity({ workspaceId: wid, clientId: client.id, type: 'property_added', title: `Added ${S.propertyTitle(p)} to portfolio`, meta: { propertyId: p.id, via: 'import' }, actor: 'system' });
        }
      }
      const areas = clean(r.searchAreas);
      const budget = parseMoneyRE(clean(r.budget));
      if (areas || budget) {
        const hasSearch = await prisma.buyerSearch.count({ where: { workspaceId: wid, clientId: client.id } });
        if (!hasSearch) {
          await prisma.buyerSearch.create({ data: { workspaceId: wid, clientId: client.id, bucket: 'active', neighborhoods: areas ? areas.split(/[;,|/]/).map((x) => x.trim()).filter(Boolean).slice(0, 12) : [], priceMax: budget || null, notes: 'Imported' } });
        }
      }
      hub.broadcast(wid, 'client_updated', S.listRow(client));
    } catch (err) {
      stats.errors++;
      errors.push({ row: rowNum, error: err.message.slice(0, 160) });
    }
  }

  const prev = job.stats || {};
  const total = { created: (prev.created || 0) + stats.created, updated: (prev.updated || 0) + stats.updated, skipped: (prev.skipped || 0) + stats.skipped, errors: (prev.errors || 0) + stats.errors, seen: [...seenKey].slice(-5000) };
  const updated = await prisma.importJob.update({ where: { id: job.id }, data: { stats: total, status: final ? 'done' : 'importing', error: errors.length ? JSON.stringify(errors.slice(0, 20)) : job.error } });
  const { seen, ...publicTotals } = total;
  res.json({ created: stats.created, updated: stats.updated, skipped: stats.skipped, failed: stats.errors, errors, totals: publicTotals, job: { ...updated, stats: publicTotals } });
}));

router.get('/jobs', ah(async (req, res) => {
  const jobs = await prisma.importJob.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { createdAt: 'desc' }, take: 20 });
  res.json({ jobs: jobs.map((j) => ({ ...j, stats: j.stats ? { created: j.stats.created, updated: j.stats.updated, skipped: j.stats.skipped, errors: j.stats.errors } : null })), total: jobs.length });
}));

module.exports = router;
