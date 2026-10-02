// node --test src/services/pipeline — commission maths vectors + web-mirror parity.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('./commission');

const PLAN = C.preparePlan({ agentSplit: 0.7, transactionFee: 395, postCapTransactionFee: 250 });

test('buyer side: price × default buyer rate × split, minus company dollar and fee', () => {
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 4250000 }, PLAN);
  assert.equal(e.sideGci, 106250);
  assert.equal(e.myGci, 106250);
  assert.equal(e.companyDollar, 31875);
  assert.equal(e.fee, 395);
  assert.equal(e.net, 106250 - 31875 - 395);
  assert.equal(e.sides, 1);
});

test('listing side uses list price and listing default rate', () => {
  const e = C.estimate({ side: 'listing', stage: 'active', listPrice: 8000000 }, PLAN);
  assert.equal(e.price, 8000000);
  assert.equal(e.sideGci, 240000);
});

test('dual: list + buy rates, counts two sides', () => {
  const d = { side: 'dual', stage: 'offer_received', listPrice: 5000000, listRate: 0.03, buyRate: 0.025 };
  assert.equal(Math.round(C.sideGci(d, PLAN)), 275000);
  assert.equal(C.dealSides(d), 2);
});

test('lease: one month of rent by default, leaseFeeMonths overrides', () => {
  assert.equal(C.sideGci({ side: 'lease_tenant', monthlyRent: 25000 }, PLAN), 25000);
  assert.equal(C.sideGci({ side: 'lease_landlord', monthlyRent: 20000, extras: { leaseFeeMonths: 1.5 } }, PLAN), 30000);
  assert.equal(C.dealVolume({ side: 'lease_tenant', monthlyRent: 25000 }), 0);
});

test('referral out: fee you receive, zero sides', () => {
  const d = { side: 'referral_out', stage: 'touring', price: 3000000, sideRate: 0.025 };
  assert.equal(Math.round(C.sideGci(d, PLAN)), 18750);
  assert.equal(C.dealSides(d), 0);
});

test('split share halves GCI and sides (generalised half deal)', () => {
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 2000000, splitShare: 0.5 }, PLAN);
  assert.equal(e.myGci, 25000);
  assert.equal(e.sides, 0.5);
});

test('referral-out % comes off the top, co-op bonus is added', () => {
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 4000000, referralOutPct: 0.25, coopBonus: 5000 }, C.preparePlan({ agentSplit: 1 }));
  assert.equal(e.myGci, 100000);
  assert.equal(e.referralOut, 25000);
  assert.equal(e.adj, 80000);
  assert.equal(e.net, 80000);
});

test('franchise fee respects its annual cap', () => {
  const plan = C.preparePlan({ agentSplit: 1, franchisePct: 0.06, franchiseCap: 3000 });
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 2000000 }, plan, { franchise: 2000 });
  assert.equal(e.franchise, 1000);
  assert.equal(e.net, 50000 - 1000);
});

test('brokerage split stops at the cap and the post-cap fee applies', () => {
  const plan = C.preparePlan({ agentSplit: 0.7, capAmount: 20000, transactionFee: 395, postCapTransactionFee: 250 });
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 4000000 }, plan, { company: 15000 });
  assert.equal(e.companyDollar, 5000);
  assert.equal(e.towardCap, 5000);
  assert.equal(e.capped, true);
  assert.equal(e.fee, 250);
  assert.equal(e.net, 100000 - 5000 - 250);
});

test('post-cap split below 100% keeps a company share after the cap', () => {
  const plan = C.preparePlan({ agentSplit: 0.8, capAmount: 10000, postCapSplit: 0.95 });
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 4000000 }, plan, { company: 10000 });
  assert.equal(e.companyDollar, 5000);
  assert.equal(e.towardCap, 0);
});

test('tiers: split by GCI earned so far this cap year', () => {
  const plan = C.preparePlan({ planType: 'tiered', tiers: [{ fromGci: 0, agentSplit: 0.6 }, { fromGci: 150000, agentSplit: 0.8 }] });
  assert.equal(C.splitFor(plan, 0), 0.6);
  assert.equal(C.splitFor(plan, 200000), 0.8);
  const e = C.estimate({ side: 'buyer', stage: 'touring', price: 2000000 }, plan, { gci: 200000 });
  assert.equal(e.companyDollar, 10000);
});

test('booked commission wins and is never re-split', () => {
  const d = { side: 'buyer', stage: 'closed', salePrice: 4000000, splitShare: 0.5, commission: 50000 };
  assert.equal(C.dealNet(d, PLAN), 50000);
  const e = C.estimate(d, PLAN);
  assert.equal(e.net, 50000);
  assert.equal(e.booked, true);
});

test('booked GCI (grossCommission) replaces the computed share', () => {
  const e = C.estimate({ side: 'buyer', stage: 'closed', salePrice: 4000000, grossCommission: 90000 }, C.preparePlan({ agentSplit: 1 }));
  assert.equal(e.myGci, 90000);
  assert.equal(e.net, 90000);
});

test('no price → zero, no negative fee-only net', () => {
  const e = C.estimate({ side: 'buyer', stage: 'new_lead' }, PLAN);
  assert.equal(e.net, 0);
  assert.equal(e.fee, 0);
});

test('closings are processed chronologically across the cap', () => {
  const plan = C.preparePlan({ agentSplit: 0.7, capAmount: 20000, transactionFee: 395, postCapTransactionFee: 250 });
  const deals = [
    { id: 'b', side: 'buyer', stage: 'closed', salePrice: 2000000, closedAt: '2026-05-01' },
    { id: 'a', side: 'buyer', stage: 'closed', salePrice: 2000000, closedAt: '2026-02-01' },
  ];
  const r = C.processClosings(deals, plan);
  assert.deepEqual(r.rows.map((x) => x.id), ['a', 'b']);
  assert.equal(r.rows[0].companyDollar, 15000);
  assert.equal(r.rows[1].companyDollar, 5000);
  assert.equal(r.rows[1].fee, 250);
  assert.equal(r.totals.company, 20000);
  assert.equal(r.totals.sides, 2);
  assert.equal(r.totals.volume, 4000000);
});

test('price field + caption follow the deal phase', () => {
  assert.equal(C.priceField({ side: 'buyer', stage: 'touring' }), 'price');
  assert.equal(C.priceField({ side: 'listing', stage: 'active' }), 'listPrice');
  assert.equal(C.priceField({ side: 'buyer', stage: 'under_contract' }), 'contractPrice');
  assert.equal(C.priceField({ side: 'buyer', stage: 'closed' }), 'salePrice');
  assert.equal(C.priceCaption({ side: 'listing', stage: 'active', listPrice: 1 }), 'LIST');
  assert.equal(C.dealPrice({ side: 'buyer', stage: 'closed', contractPrice: 3100000, price: 3000000 }), 3100000);
});

test('web mirror produces identical results', async () => {
  const file = path.resolve(__dirname, '../../../../web/src/components/pipeline/commission.js');
  let W;
  try { W = await import(pathToFileURL(file).href); } catch (err) { assert.fail(`web mirror missing: ${err.message}`); }
  const plans = [
    PLAN,
    C.preparePlan({ agentSplit: 0.7, capAmount: 20000, transactionFee: 395, postCapTransactionFee: 250, franchisePct: 0.06, franchiseCap: 3000 }),
    C.preparePlan({ planType: 'tiered', tiers: [{ fromGci: 0, agentSplit: 0.6 }, { fromGci: 150000, agentSplit: 0.8 }], teamLeadPct: 0.5 }),
  ];
  const deals = [
    { side: 'buyer', stage: 'touring', price: 4250000 },
    { side: 'listing', stage: 'active', listPrice: 8000000, sideRate: 0.025 },
    { side: 'dual', stage: 'under_contract', contractPrice: 5000000, listRate: 0.03, buyRate: 0.025, splitShare: 0.6 },
    { side: 'lease_tenant', stage: 'touring', monthlyRent: 25000 },
    { side: 'referral_out', stage: 'touring', price: 3000000, sideRate: 0.025, extras: { referralFeePct: 0.3 } },
    { side: 'buyer', stage: 'closed', salePrice: 4000000, commission: 50000, splitShare: 0.5 },
    { side: 'buyer', stage: 'offer_submitted', price: 6000000, referralOutPct: 0.25, coopBonus: 10000, extras: { teamSourced: true } },
  ];
  const ytds = [undefined, { gci: 200000, company: 15000, franchise: 2500 }];
  for (const p of plans) {
    const wp = W.preparePlan(p);
    for (const d of deals) {
      for (const y of ytds) {
        const a = C.estimate(d, p, y);
        const b = W.estimate(d, wp, y);
        assert.deepEqual(b, a, `mismatch for ${JSON.stringify(d)}`);
      }
    }
  }
});
