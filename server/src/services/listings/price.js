// Price-change bookkeeping (port of RM priceChangeFields, spec 06 §5.8/§8.3):
//  • a fall stamps previousPrice + priceDroppedAt;
//  • a second fall on the SAME market day keeps the original previousPrice
//    (so "↓ $350K" shows the whole day's drop, not just the last step);
//  • any rise clears the drop.
// Every change also writes a ListingPriceEvent (same-day falls merge into the
// day's event so the history reads cleanly).
const prisma = require('../../lib/prisma');
const { dayKey } = require('../../lib/dates');

function priceChangeFields(prior, newPrice, now = new Date(), tz) {
  const old = prior && Number(prior.listPrice);
  const next = Number(newPrice);
  if (!Number.isFinite(next) || next <= 0 || !Number.isFinite(old) || old <= 0 || next === old) return {};
  if (next < old) {
    const sameDay = prior.priceDroppedAt && Number(prior.previousPrice) > next
      && dayKey(new Date(prior.priceDroppedAt), tz) === dayKey(now, tz);
    return { previousPrice: sameDay ? Number(prior.previousPrice) : old, priceDroppedAt: now };
  }
  return { previousPrice: null, priceDroppedAt: null };
}

async function recordPriceEvent(listingId, fromPrice, toPrice, now = new Date(), tz) {
  if (!Number.isFinite(Number(fromPrice)) || !Number.isFinite(Number(toPrice)) || Number(fromPrice) === Number(toPrice)) return null;
  const last = await prisma.listingPriceEvent.findFirst({ where: { listingId }, orderBy: { changedAt: 'desc' } });
  const isDrop = Number(toPrice) < Number(fromPrice);
  if (last && isDrop && last.toPrice > 0 && last.toPrice < last.fromPrice && last.toPrice === Number(fromPrice)
    && dayKey(new Date(last.changedAt), tz) === dayKey(now, tz)) {
    return prisma.listingPriceEvent.update({ where: { id: last.id }, data: { toPrice: Number(toPrice), changedAt: now } });
  }
  return prisma.listingPriceEvent.create({ data: { listingId, fromPrice: Number(fromPrice), toPrice: Number(toPrice), changedAt: now } });
}

module.exports = { priceChangeFields, recordPriceEvent };
