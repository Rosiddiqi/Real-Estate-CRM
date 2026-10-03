// Import — bring a book of clients in from a CSV / TSV (Google, Follow Up
// Boss, kvCORE, Excel "Save as CSV") or a vCard export (iPhone / iCloud).
// Parsed in the browser → columns mapped (AI-assisted, header-name fallback)
// → preview → chunked import with live progress → created / updated / skipped.
import { useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/clients.css';
import PushPanel from '../../components/ui/PushPanel';
import Icon from '../../components/ui/Icon';
import { Spinner, EmptyState } from '../../components/ui/kit';
import { toast } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { formatPhone } from '../../lib/format';
import { analyzeImport, executeImport, listImports } from '../../api/clients';
import { Seg } from '../../components/client/clientKit';

// ── parsers ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows = [];
  let row = []; let field = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: rows.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim())) };
}

const VCF_HEADERS = ['Full name', 'First name', 'Last name', 'Mobile', 'Other phone', 'Email', 'Other email', 'Company', 'Title', 'Street', 'City', 'State', 'ZIP', 'Birthday', 'Notes', 'Tags', 'Spouse'];
function parseVCF(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1).map((c) => c.split(/END:VCARD/i)[0]);
  const rows = [];
  for (const card of cards) {
    const rec = { phones: [], emails: [] };
    for (const line of card.split('\n')) {
      const m = /^([^:]+):(.*)$/.exec(line.trim());
      if (!m) continue;
      const [keyRaw, valueRaw] = [m[1], m[2]];
      const key = keyRaw.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      const params = keyRaw.toUpperCase();
      const value = valueRaw.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
      if (key === 'FN') rec.fn = value;
      else if (key === 'N') { const [last, first] = value.split(';'); rec.last = last; rec.first = first; }
      else if (key === 'TEL') rec.phones.push({ v: value, cell: /CELL|MOBILE|IPHONE/.test(params) });
      else if (key === 'EMAIL') rec.emails.push(value);
      else if (key === 'ORG') rec.org = value.split(';')[0];
      else if (key === 'TITLE') rec.title = value;
      else if (key === 'ADR') { const p = value.split(';'); rec.street = p[2]; rec.city = p[3]; rec.state = p[4]; rec.zip = p[5]; }
      else if (key === 'BDAY') rec.bday = value.replace(/^--/, '--');
      else if (key === 'NOTE') rec.note = value;
      else if (key === 'CATEGORIES') rec.tags = value;
      else if (key === 'X-ABRELATEDNAMES' || key === 'RELATED') { if (/SPOUSE|PARTNER|WIFE|HUSBAND/.test(params) || !rec.spouse) rec.spouse = value; }
    }
    const cell = rec.phones.find((p) => p.cell) || rec.phones[0];
    const other = rec.phones.find((p) => p !== cell);
    rows.push([rec.fn || '', rec.first || '', rec.last || '', cell ? cell.v : '', other ? other.v : '', rec.emails[0] || '', rec.emails[1] || '', rec.org || '', rec.title || '', rec.street || '', rec.city || '', rec.state || '', rec.zip || '', rec.bday || '', rec.note || '', rec.tags || '', rec.spouse || '']);
  }
  return { headers: VCF_HEADERS, rows };
}

// ── helpers ──────────────────────────────────────────────────────────────
function mapRow(row, mapping) {
  const out = {};
  row.forEach((val, i) => {
    const field = mapping[i];
    if (!field || val == null || String(val).trim() === '') return;
    if (out[field] && (field === 'tags' || field === 'notes')) out[field] = `${out[field]}${field === 'tags' ? ', ' : '\n'}${val}`;
    else if (!out[field]) out[field] = String(val).trim();
  });
  return out;
}
const nameOf = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.fullName || m.company || m.email || '';

function Steps({ step }) {
  return <div className="kc-steps">{[1, 2, 3, 4].map((s) => <span key={s} className={s <= step ? 'kc-on' : ''} />)}</div>;
}

export default function ImportPage({ onClose }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [onDup, setOnDup] = useState('update');
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState(null);
  const input = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => { listImports().then((r) => setJobs(r.jobs || [])).catch(() => setJobs([])); return () => { cancelled.current = true; }; }, []);

  const readFile = async (f) => {
    if (!f) return;
    const name = f.name || 'import';
    if (/\.(xlsx|xls|numbers)$/i.test(name)) { toast.error('Save the spreadsheet as CSV first (File → Export → CSV), then drop it here.'); return; }
    setBusy(true);
    try {
      const text = await f.text();
      const isVcf = /\.vcf$/i.test(name) || /^\s*BEGIN:VCARD/i.test(text);
      const p = isVcf ? parseVCF(text) : parseCSV(text);
      if (!p.headers.length || !p.rows.length) { toast.error('That file has no rows we can read.'); setBusy(false); return; }
      setFile({ name, format: isVcf ? 'vcf' : 'csv' });
      setParsed(p);
      const r = await analyzeImport({ fileName: name, format: isVcf ? 'vcf' : 'csv', headers: p.headers, sample: p.rows.slice(0, 8), totalRows: p.rows.length });
      setAnalysis(r);
      setMapping(r.mapping || {});
      setStep(2);
    } catch (e) {
      toast.error(e.message || 'Couldn’t read that file');
    }
    setBusy(false);
  };

  const fields = analysis?.fields || [];
  const mappedRows = useMemo(() => (parsed ? parsed.rows.map((r) => mapRow(r, mapping)) : []), [parsed, mapping]);
  const withNames = mappedRows.filter((m) => nameOf(m)).length;
  const usedFields = new Set(Object.values(mapping).filter(Boolean));

  const run = async () => {
    if (!analysis?.job?.id || busy) return;
    setBusy(true); setStep(4); cancelled.current = false;
    const rows = mappedRows;
    const totals = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    const CHUNK = 100;
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        if (cancelled.current) break;
        const chunk = rows.slice(i, i + CHUNK);
        const r = await executeImport({ jobId: analysis.job.id, rows: chunk, onDuplicate: onDup, final: i + CHUNK >= rows.length, startIndex: i });
        totals.created += r.created || 0; totals.updated += r.updated || 0; totals.skipped += r.skipped || 0; totals.failed += r.failed || 0;
        totals.errors.push(...(r.errors || []));
        setProgress({ done: Math.min(rows.length, i + CHUNK), total: rows.length });
      }
      setSummary(totals);
      toast.success(`Imported — ${totals.created} new, ${totals.updated} updated`);
    } catch (e) {
      setSummary({ ...totals, fatal: e.message || 'Import stopped' });
      toast.error(e.message || 'Import stopped');
    }
    setBusy(false);
  };

  const reset = () => { setStep(1); setFile(null); setParsed(null); setAnalysis(null); setMapping({}); setSummary(null); setProgress(null); };

  return (
    <PushPanel onClose={onClose} title="Import clients" subtitle={file ? file.name : 'CSV · vCard'}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '6px 16px 0' }}>
        <Steps step={step} />

        {step === 1 ? (
          <>
            <button
              type="button"
              className={`kc-drop ${over ? 'kc-drop--over' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
              disabled={busy}
            >
              <span style={{ width: 56, height: 56, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--tint)', color: 'var(--bright)' }}>
                {busy ? <Spinner size={24} /> : <Icon name="upload" size={26} stroke={2} />}
              </span>
              <span style={{ fontSize: 17, fontWeight: 500 }}>{busy ? 'Reading your file…' : 'Choose a file'}</span>
              <span style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 300 }}>CSV or vCard (.vcf). We’ll map the columns for you — nothing is imported until you confirm.</span>
            </button>
            <input ref={input} type="file" hidden accept=".csv,.tsv,.txt,.vcf,text/csv,text/vcard,text/x-vcard" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; readFile(f); }} />
            <div className="kc-section-title"><h3>Works with</h3></div>
            <div className="kc-touch">
              {['iPhone / iCloud (vCard)', 'Google Contacts (CSV)', 'Follow Up Boss', 'kvCORE', 'LionDesk', 'Excel → Save as CSV'].map((s) => <span key={s}>{s}</span>)}
            </div>
            <div className="kc-section-title"><h3>Recent imports</h3></div>
            {jobs === null ? <Spinner /> : jobs.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>No imports yet.</div> : jobs.slice(0, 6).map((j) => (
              <div key={j.id} className="kc-info">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="kc-info-v km-truncate" style={{ marginTop: 0, fontSize: 14.5 }}>{j.fileName || 'Import'}</div>
                  <div className="kc-info-l" style={{ marginTop: 2 }}>{new Date(j.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {j.status}{j.stats ? ` · ${j.stats.created || 0} new · ${j.stats.updated || 0} updated` : ''}</div>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {step === 2 && parsed ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className={`kc-tag kc-tag--mono ${analysis?.source === 'ai' ? 'kc-tag--violet' : ''}`}>{analysis?.source === 'ai' ? 'AI-mapped' : 'Auto-mapped'}</span>
              <span style={{ fontSize: 13, color: 'var(--dim)' }}>{parsed.rows.length} rows · {parsed.headers.length} columns</span>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--dim)', marginBottom: 6 }}>Check each column. Anything set to “Skip” stays out.</div>
            {parsed.headers.map((h, i) => {
              const conf = analysis?.confidence?.[i] ?? 0;
              const sample = parsed.rows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ');
              return (
                <div key={`${h}${i}`} className="kc-maprow">
                  <span className="kc-dot" style={{ background: mapping[i] ? (conf >= 0.9 ? 'var(--green)' : conf >= 0.5 ? 'var(--amber)' : 'var(--blue)') : 'var(--ghost)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="km-truncate" style={{ fontSize: 14.5, fontWeight: 500 }}>{h}</div>
                    <div className="km-truncate" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{sample || '—'}</div>
                  </div>
                  <select className="km-input" style={{ minHeight: 38, padding: '6px 30px 6px 10px', fontSize: 14 }} value={mapping[i] || ''} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value || null }))}>
                    <option value="">Skip</option>
                    {fields.map((f) => <option key={f.key} value={f.key} disabled={usedFields.has(f.key) && mapping[i] !== f.key && !['tags', 'notes'].includes(f.key)}>{f.label}</option>)}
                  </select>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" className="km-btn km-btn--ghost" style={{ flex: 1 }} onClick={reset}>Start over</button>
              <button type="button" className="km-btn" style={{ flex: 1.4 }} disabled={!withNames} onClick={() => setStep(3)}>Preview</button>
            </div>
            {!withNames ? <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 8 }}>Map at least a name column to continue.</div> : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div className="kc-bigstat"><b>{mappedRows.length}</b><span className="kc-eyebrow">Rows</span></div>
              <div className="kc-bigstat"><b style={{ color: 'var(--green)' }}>{withNames}</b><span className="kc-eyebrow">With a name</span></div>
              <div className="kc-bigstat"><b style={{ color: 'var(--faint)' }}>{mappedRows.length - withNames}</b><span className="kc-eyebrow">Skipped</span></div>
            </div>
            <div className="kc-eyebrow" style={{ margin: '14px 2px 8px' }}>When someone’s already in your book</div>
            <Seg value={onDup} onChange={setOnDup} options={[{ value: 'update', label: 'Fill in blanks' }, { value: 'skip', label: 'Skip them' }]} />
            <div className="kc-section-title"><h3>First rows</h3></div>
            {mappedRows.filter((m) => nameOf(m)).slice(0, 6).map((m, i) => (
              <div key={i} className="kc-info">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="kc-info-v km-truncate" style={{ marginTop: 0, fontWeight: 500 }}>{nameOf(m)}</div>
                  <div className="kc-info-l km-truncate" style={{ marginTop: 3, fontSize: 12.5 }}>{[m.phone ? formatPhone(m.phone) : null, m.email, m.company, m.tags].filter(Boolean).join(' · ') || 'Name only'}</div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" className="km-btn km-btn--ghost" style={{ flex: 1 }} onClick={() => setStep(2)}>Back</button>
              <button type="button" className="km-btn" style={{ flex: 1.4 }} onClick={run}>Import {withNames} {withNames === 1 ? 'client' : 'clients'}</button>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          summary ? (
            <>
              <div style={{ textAlign: 'center', margin: '8px 0 18px' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: summary.fatal ? 'rgba(255, 107, 94, 0.12)' : 'rgba(var(--hl-rgb), 0.12)', color: summary.fatal ? 'var(--red)' : 'var(--green)', animation: 'km-pop .4s var(--km-spring)' }}>
                  <Icon name={summary.fatal ? 'alert' : 'check'} size={30} stroke={2.6} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 500, marginTop: 12 }}>{summary.fatal ? 'Import stopped' : 'Import complete'}</div>
                {summary.fatal ? <div style={{ fontSize: 13.5, color: 'var(--red)', marginTop: 4 }}>{summary.fatal}</div> : null}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="kc-bigstat"><b style={{ color: 'var(--green)' }}>{summary.created}</b><span className="kc-eyebrow">Created</span></div>
                <div className="kc-bigstat"><b style={{ color: 'var(--bright)' }}>{summary.updated}</b><span className="kc-eyebrow">Updated</span></div>
                <div className="kc-bigstat"><b style={{ color: 'var(--faint)' }}>{summary.skipped + summary.failed}</b><span className="kc-eyebrow">Skipped</span></div>
              </div>
              {summary.errors.length ? (
                <>
                  <div className="kc-section-title"><h3>Needs a look</h3></div>
                  {summary.errors.slice(0, 10).map((e, i) => <div key={i} style={{ fontSize: 13, color: 'var(--dim)', padding: '6px 0', borderBottom: '1px solid var(--kc-hair)' }}>Row {e.row}: {e.error}</div>)}
                </>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="km-btn km-btn--ghost" style={{ flex: 1 }} onClick={reset}>Import another</button>
                <button type="button" className="km-btn" style={{ flex: 1.4 }} onClick={() => { nav.go('clients'); }}>View clients</button>
              </div>
            </>
          ) : (
            <div style={{ padding: '30px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 500 }}>Importing…</div>
              <div style={{ fontSize: 13.5, color: 'var(--dim)', margin: '6px 0 16px' }}>{progress ? `${progress.done} of ${progress.total}` : 'Starting'}</div>
              <div className="kc-progress"><div style={{ width: progress ? `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : '4%' }} /></div>
            </div>
          )
        ) : null}

        {step === 2 && !parsed ? <EmptyState icon="file" title="Nothing to map" sub="Choose a file to begin." /> : null}
      </div>
    </PushPanel>
  );
}
