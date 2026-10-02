// Defaults every new workspace gets: pay plan, work schedule, listing sources.
const prisma = require('../lib/prisma');

const DEFAULT_WEEKLY = {
  mon: { start: '09:00', end: '18:00', off: false },
  tue: { start: '09:00', end: '18:00', off: false },
  wed: { start: '09:00', end: '18:00', off: false },
  thu: { start: '09:00', end: '18:00', off: false },
  fri: { start: '09:00', end: '18:00', off: false },
  sat: { start: '10:00', end: '17:00', off: false }, // weekends are prime showing days
  sun: { start: '11:00', end: '16:00', off: false },
};

const DEFAULT_SOURCES = [
  { name: 'My Listings', kind: 'own', color: '#2E8BFF' },
  { name: 'Pocket & Coming Soon', kind: 'pocket', color: '#9A4DFF' },
  { name: 'Whispers', kind: 'whisper', color: '#F2A93B' },
  { name: 'MLS Feed', kind: 'mls', color: '#30D27A' },
];

async function bootstrapWorkspace(workspaceId, userId) {
  const existingPlan = await prisma.payPlan.findFirst({ where: { workspaceId } });
  if (!existingPlan) {
    await prisma.payPlan.create({
      data: {
        workspaceId, userId, name: 'Brokerage plan', planType: 'split_cap',
        defaultBuyerRate: 0.025, defaultListingRate: 0.03, agentSplit: 0.8,
        capAmount: 24000, capAnniversary: '01-01', postCapSplit: 1,
        transactionFee: 395, postCapTransactionFee: 250,
        goals: { annualGci: 1500000, annualSides: 24, annualVolume: 120000000, monthlySides: 2 },
      },
    });
  }
  if (userId) {
    const ws = await prisma.workSchedule.findUnique({ where: { userId } });
    if (!ws) {
      await prisma.workSchedule.create({
        data: {
          workspaceId, userId, weekly: DEFAULT_WEEKLY,
          contentBlock: { durationMin: 90, preferredStart: '10:00', enabled: true },
          lunch: { durationMin: 45, preferredStart: '12:30', enabled: true },
        },
      });
    }
  }
  const sources = await prisma.listingSource.count({ where: { workspaceId } });
  if (!sources) {
    await prisma.listingSource.createMany({ data: DEFAULT_SOURCES.map((s) => ({ ...s, workspaceId })) });
  }
}

module.exports = { bootstrapWorkspace, DEFAULT_WEEKLY };
