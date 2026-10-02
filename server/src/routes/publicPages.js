// /api/public — unauthenticated, server-rendered pages.
//
//   GET /api/public/p/:slug   private showcase page for one listing (texted 1:1 to a client)
//
// Mobile-first editorial layout in the KeyMatch tokens. noindex + no-store;
// the 10-char unguessable slug is the only key. When the listing hides its
// address (pocket default) no street, unit, MLS# or parcel ever renders.
// Treat as 1:1 private sharing (check MLS off-market marketing rules before
// any public marketing).
const express = require('express');
const prisma = require('../lib/prisma');
const shape = require('../services/listings/shape');
const V = require('../services/matchmaker/vocab');

const router = express.Router();

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : null);
const num = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));

function lotText(l) {
  const sq = l.lotSqft || (l.lotAcres ? l.lotAcres * 43560 : null);
  if (!sq) return null;
  const ac = sq / 43560;
  return ac >= 0.5 ? `${ac.toFixed(ac >= 10 ? 0 : 2).replace(/\.?0+$/, '')} AC` : `${num(Math.round(sq))} SF`;
}

const CSS = `
:root{--bg:#06080C;--surface:#0E131C;--line:rgba(255,255,255,.09);--text:#fff;--dim:rgba(255,255,255,.62);--faint:rgba(255,255,255,.38);
--blue:#2E8BFF;--bright:#4DA2FF;--deep:#1567E0;--gold:#D9B677;--sms:#34D15B;
--sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Inter,system-ui,sans-serif;
--serif:ui-serif,"New York","Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif;
--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
body{max-width:520px;margin:0 auto;padding-bottom:calc(110px + env(safe-area-inset-bottom,0px))}
a{color:inherit}
.hero{position:relative;height:100svh;min-height:560px;max-height:920px;overflow:hidden;background:linear-gradient(160deg,#1E5A7A,#0F2A44 70%)}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero .ph{position:absolute;inset:0}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,8,12,.55) 0%,rgba(6,8,12,0) 22%,rgba(6,8,12,0) 45%,rgba(6,8,12,.86) 78%,var(--bg) 100%)}
.top{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 18px) 22px 0;font-size:11px;letter-spacing:.24em;text-transform:uppercase}
.mark b{font-weight:800}.mark span{font-weight:400;opacity:.8}
.no{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:var(--dim)}
.copy{position:absolute;left:0;right:0;bottom:0;padding:0 22px calc(96px + env(safe-area-inset-bottom,0px))}
.kicker{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--gold);font-weight:600}
h1{font-family:var(--sans);font-weight:700;font-size:44px;line-height:1;letter-spacing:-.035em;margin:12px 0 0}
h1.long{font-size:34px}
.sub{font-family:var(--serif);font-style:italic;font-size:19px;color:var(--dim);margin-top:10px}
.ledger{display:grid;grid-template-columns:1fr 1fr;margin-top:22px;border-top:1px solid var(--line)}
.ledger>div{padding:14px 0 0}.ledger>div+div{padding-left:18px;border-left:1px solid var(--line)}
.lab{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--faint);font-weight:600}
.val{font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:6px;font-variant-numeric:tabular-nums}
.val.gold{color:var(--gold)}
.band{display:grid;grid-template-columns:repeat(3,1fr);margin:6px 22px 0;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
.band>div{padding:16px 10px;text-align:center}.band>div+div{border-left:1px solid var(--line)}
.band .val{font-size:22px;margin-top:4px}
.pill{display:flex;align-items:center;justify-content:center;gap:8px;margin:18px 22px 0;height:50px;border-radius:999px;border:1px solid rgba(217,182,119,.5);color:var(--gold);font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-decoration:none}
section{padding:40px 22px 0}
.sec{display:flex;align-items:baseline;gap:12px;font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--faint);font-weight:600;margin-bottom:16px}
.sec i{font-style:normal;font-family:var(--mono);color:var(--gold)}
.sec:after{content:"";flex:1;height:1px;background:var(--line);transform:translateY(-3px)}
.gal{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:0 -22px}
.gal button{all:unset;cursor:pointer;position:relative;overflow:hidden;aspect-ratio:1/1;background:linear-gradient(160deg,#2F5D4A,#1B2A22)}
.gal button.wide{grid-column:1/-1;aspect-ratio:16/10}
.gal img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.rows div{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);font-size:15px}
.rows span:first-child{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);font-weight:600;padding-top:2px}
.rows span:last-child{text-align:right;font-weight:500}
.feat{display:flex;flex-wrap:wrap;gap:8px}
.feat span{padding:9px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-size:14px}
.feat .more{display:none}.feat.open .more{display:inline-block}
.showall{all:unset;cursor:pointer;margin-top:14px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);font-weight:600}
.desc{font-family:var(--serif);font-size:18px;line-height:1.6;color:rgba(255,255,255,.82)}
.desc p{margin:0 0 14px}
footer{padding:56px 22px 20px;text-align:center}
.sig{font-family:var(--serif);font-style:italic;font-size:24px}
.via{margin-top:14px;font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:var(--faint)}
.fine{margin-top:12px;font-size:11px;color:var(--faint);line-height:1.5}
.bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));width:min(492px,calc(100% - 28px));display:flex;gap:10px;padding:8px;border-radius:999px;
background:rgba(12,14,18,.42);-webkit-backdrop-filter:blur(14px) saturate(180%);backdrop-filter:blur(14px) saturate(180%);box-shadow:inset 0 0 6px rgba(255,255,255,.22),0 10px 30px rgba(0,0,0,.45);z-index:10}
.call{flex:0 0 52px;height:52px;border-radius:50%;background:var(--sms);display:flex;align-items:center;justify-content:center}
.text{flex:1;min-width:0;height:52px;padding:0 16px;border-radius:999px;background:linear-gradient(180deg,var(--bright),var(--deep));display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:clamp(13px,3.9vw,15.5px);white-space:nowrap;text-decoration:none;box-shadow:0 10px 24px -8px rgba(46,139,255,.5)}.text span{overflow:hidden;text-overflow:ellipsis}
.sold{position:absolute;top:calc(env(safe-area-inset-top,0px) + 56px);left:22px;padding:6px 12px;border-radius:999px;background:rgba(6,8,12,.6);border:1px solid var(--gold);color:var(--gold);font-size:11px;letter-spacing:.2em;font-weight:700}
.viewer{position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:50;display:none;align-items:center;justify-content:center}
.viewer.on{display:flex}.viewer img{max-width:100%;max-height:100%;object-fit:contain}
.viewer .x{position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);right:14px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;border:0;font-size:20px}
.viewer .n{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);left:0;right:0;text-align:center;font-family:var(--mono);font-size:12px;color:var(--dim);letter-spacing:.12em}
.nf{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
@media (prefers-reduced-motion:no-preference){.copy{animation:rise .9s cubic-bezier(.2,.8,.2,1) both}@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}}
`;

const PH_SVG = '<svg class="ph" viewBox="0 0 400 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><g fill="none" stroke="#7FB8D6" stroke-opacity=".55" stroke-width="2"><path d="M60 470V330h170v140M200 330v-70h150v210"/><path d="M20 470h360"/><path d="M90 370h55v100M240 290h90M260 340h70v130" stroke-opacity=".35"/></g><circle cx="320" cy="140" r="34" fill="#7FB8D6" fill-opacity=".18"/></svg>';

function page({ title, body, og = {} }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#06080C"><title>${esc(title)}</title>
<meta property="og:title" content="${esc(og.title || title)}">${og.description ? `<meta property="og:description" content="${esc(og.description)}">` : ''}${og.image ? `<meta property="og:image" content="${esc(og.image)}">` : ''}
<meta name="twitter:card" content="summary_large_image"><style>${CSS}</style></head><body>${body}</body></html>`;
}

function notFound(res, msg = 'This home is no longer available.') {
  res.status(404).set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').type('html').send(page({
    title: 'Private Residence',
    body: `<div class="nf"><div class="kicker">Private presentation</div><h1 class="long" style="margin-top:14px">${esc(msg)}</h1><div class="sub">Reach out to your agent for similar homes.</div></div>`,
  }));
}

router.get('/p/:slug', async (req, res) => {
  try {
    // slugs are unguessable 10-char tokens; case-insensitive so a link typed
    // or auto-capitalized by a phone still opens (seeded slugs are lowercase)
    const slug = String(req.params.slug || '');
    if (!/^[A-Za-z0-9]{6,16}$/.test(slug)) return notFound(res);
    const l = await prisma.listing.findFirst({ where: { publicSlug: { equals: slug, mode: 'insensitive' }, droppedAt: null } });
    if (!l || l.origin === 'whisper' || ['withdrawn', 'expired'].includes(l.status)) return notFound(res);
    const [ws, agent] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: l.workspaceId }, select: { name: true, brokerageName: true, officeName: true } }),
      prisma.user.findFirst({ where: { workspaceId: l.workspaceId }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], select: { firstName: true, lastName: true, phone: true, title: true } }),
    ]);
    const hidden = !!l.hideAddress;
    const card = shape.cardShape(l);
    const photos = card.photos.slice(0, 24);
    const t = V.typeLabel(V.canonicalType(l.propertySubType) || V.canonicalType(l.propertyType)) || '';
    const wf = card.waterfrontLabel;
    const masthead = hidden ? (l.title || 'Private Residence') : (l.title || shape.streetLine(l) || l.buildingName || 'Private Residence');
    const kicker = [l.neighborhood || l.buildingName && !hidden && l.buildingName, l.city && l.city !== l.neighborhood ? l.city : l.market].filter(Boolean).join(' · ').toUpperCase();
    const subline = [wf, l.architecturalStyle || t].filter(Boolean).join(' · ');
    const price = l.status === 'sold' && l.closePrice ? money(l.closePrice) : money(l.listPrice);
    const brokerage = (ws && (ws.brokerageName || ws.name)) || 'KeyMatch';
    const first = (agent && agent.firstName) || 'your agent';
    const phone = agent && agent.phone ? String(agent.phone).replace(/[^\d+]/g, '') : null;
    const label = hidden ? `${shape.descriptor(l)}${l.neighborhood ? ` in ${l.neighborhood}` : ''}` : shape.clientLabel(l);
    const smsBody = `I'm interested in the ${label}${price ? ` (${price})` : ''}. Is it still available?`;
    const no = hidden ? slug.slice(-6) : (l.mlsNumber ? l.mlsNumber.slice(-6) : slug.slice(-6));
    const baths = card.baths;

    const specs = [
      ['Year built', l.yearRenovated && l.yearRenovated > (l.yearBuilt || 0) ? `${l.yearBuilt || '—'} · renovated ${l.yearRenovated}` : l.yearBuilt],
      ['Interior', card.sqft ? `${num(card.sqft)} sq ft` : null],
      ['Lot', lotText(l) ? lotText(l).replace(' AC', ' acres').replace(' SF', ' sq ft') : null],
      ['Type', t || null],
      ['Waterfront', wf ? `${wf}${l.waterFrontageFt ? ` · ${l.waterFrontageFt} ft frontage` : ''}${l.dockLengthFt ? ` · ${l.dockLengthFt} ft dock` : ''}` : null],
      ['Views', (l.views || []).length ? l.views.map((v) => v.charAt(0).toUpperCase() + v.slice(1)).join(', ') : null],
      ['Style', l.architecturalStyle],
      ['HOA', l.hoaFee ? `${money(l.hoaFee)}${l.hoaFrequency ? ` / ${String(l.hoaFrequency).replace(/ly$/, '').replace('month', 'mo').replace('annual', 'yr').replace('year', 'yr').replace('quarter', 'qtr')}` : ' / mo'}` : null],
      ['Taxes', l.taxAnnual ? `${money(l.taxAnnual)} / yr` : null],
      ['Garage', l.garageSpaces ? `${l.garageSpaces} cars` : null],
      ...(hidden ? [] : [['MLS #', l.mlsNumber]]),
    ].filter(([, v]) => v != null && v !== '');

    const amen = (l.amenities || []).filter(Boolean);
    const galleryPhotos = photos.slice(1);
    // magazine rhythm: one full-bleed 16:10, then a pair of squares; a lone trailing square goes wide
    const n = galleryPhotos.length;
    const isWide = (i) => i % 3 === 0 || (i % 3 === 1 && i === n - 1);
    const gallery = n ? galleryPhotos.map((p, i) => `<button class="${isWide(i) ? 'wide' : ''}" data-i="${i + 1}" aria-label="Photo ${i + 2}"><img src="${esc(p)}" alt="" loading="lazy" onerror="this.remove()"></button>`).join('') : '';
    const descParas = String(l.description || '').split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean).slice(0, 6);

    const body = `
<div class="hero">${PH_SVG}${photos[0] ? `<img src="${esc(photos[0])}" alt="" onerror="this.remove()">` : ''}<div class="shade"></div>
  <div class="top"><div class="mark"><b>${esc(brokerage.split(' ')[0])}</b> <span>${esc(brokerage.split(' ').slice(1).join(' '))}</span></div><div class="no">Nº ${esc(no)}</div></div>
  ${l.status === 'sold' ? '<div class="sold">SOLD</div>' : l.status === 'coming_soon' ? '<div class="sold">COMING SOON</div>' : ''}
  <div class="copy">
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
    <h1 class="${masthead.length > 16 ? 'long' : ''}">${esc(masthead)}</h1>
    ${subline ? `<div class="sub">${esc(subline)}</div>` : ''}
    <div class="ledger"><div><div class="lab">${l.status === 'sold' ? 'Sold' : 'Price'}</div><div class="val gold">${esc(price || 'Upon request')}</div></div>
    <div><div class="lab">Interior</div><div class="val">${card.sqft ? `${esc(num(card.sqft))} <span style="font-size:14px;color:var(--dim);font-weight:500">SQ FT</span>` : '—'}</div></div></div>
  </div>
</div>
<div class="band"><div><div class="lab">Beds</div><div class="val">${esc(l.beds ?? '—')}</div></div><div><div class="lab">Baths</div><div class="val">${esc(baths ?? '—')}</div></div><div><div class="lab">${lotText(l) ? 'Lot' : 'Built'}</div><div class="val">${esc(lotText(l) || l.yearBuilt || '—')}</div></div></div>
${l.featureSheetUrl ? `<a class="pill" href="${esc(l.featureSheetUrl)}" target="_blank" rel="noopener">View floor plan</a>` : ''}
${descParas.length ? `<section><div class="sec"><i>01</i>The residence</div><div class="desc">${descParas.map((p) => `<p>${esc(p)}</p>`).join('')}</div></section>` : ''}
${gallery ? `<section><div class="sec"><i>${descParas.length ? '02' : '01'}</i>Gallery</div><div class="gal">${gallery}</div></section>` : ''}
${specs.length ? `<section><div class="sec"><i>${String(1 + (descParas.length ? 1 : 0) + (gallery ? 1 : 0)).padStart(2, '0')}</i>Specification</div><div class="rows">${specs.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></section>` : ''}
${amen.length ? `<section><div class="sec"><i>${String(2 + (descParas.length ? 1 : 0) + (gallery ? 1 : 0)).padStart(2, '0')}</i>Features</div><div class="feat" id="feat">${amen.map((a, i) => `<span class="${i >= 6 ? 'more' : ''}">${esc(a)}</span>`).join('')}</div>${amen.length > 6 ? `<button class="showall" onclick="document.getElementById('feat').classList.add('open');this.remove()">Show all ${amen.length}</button>` : ''}</section>` : ''}
<footer><div class="sig">${esc(first)} — ${esc(brokerage)}</div><div class="via">Presented privately via KeyMatch</div><div class="fine">A private presentation shared with you personally. Information deemed reliable but not guaranteed; please do not forward.</div></footer>
<div class="bar">${phone ? `<a class="call" href="tel:${esc(phone)}" aria-label="Call ${esc(first)}"><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg></a>` : ''}
<a class="text" href="sms:${esc(phone || '')}${phone ? '&' : '?'}body=${encodeURIComponent(smsBody)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Text ${esc(first)} About This Home</span></a></div>
<div class="viewer" id="v" role="dialog" aria-modal="true"><button class="x" aria-label="Close">×</button><img id="vi" alt=""><div class="n" id="vn"></div></div>
<script>(function(){var P=${JSON.stringify(photos).replace(/</g, '\\u003c')};var v=document.getElementById('v'),vi=document.getElementById('vi'),vn=document.getElementById('vn'),i=0;
function show(n){i=(n+P.length)%P.length;vi.src=P[i];vn.textContent=(i+1)+' / '+P.length;v.classList.add('on');}
function close(){v.classList.remove('on');}
document.querySelectorAll('.gal button').forEach(function(b){b.addEventListener('click',function(){show(+b.dataset.i)})});
v.addEventListener('click',function(e){if(e.target.classList.contains('x'))return close();var x=e.clientX/window.innerWidth;if(x<.3)show(i-1);else if(x>.7)show(i+1);else close();});
document.addEventListener('keydown',function(e){if(!v.classList.contains('on'))return;if(e.key==='Escape')close();if(e.key==='ArrowLeft')show(i-1);if(e.key==='ArrowRight')show(i+1);});
var sx=null;v.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});v.addEventListener('touchend',function(e){if(sx==null)return;var dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>40)show(i+(dx<0?1:-1));});})();</script>`;
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').type('html').send(page({
      title: `${masthead}${kicker ? ` · ${kicker}` : ''}`,
      body,
      og: { title: `${masthead}${l.neighborhood ? ` · ${l.neighborhood}` : ''}`, description: [price, card.beds ? `${card.beds} bd` : null, baths ? `${baths} ba` : null, card.sqft ? `${num(card.sqft)} sq ft` : null].filter(Boolean).join(' · '), image: photos[0] },
    }));
  } catch (err) {
    console.error('[public] showcase failed', err);
    notFound(res, 'This page is temporarily unavailable.');
  }
});

module.exports = router;
