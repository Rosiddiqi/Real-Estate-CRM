// Workspace (the agent's book): brokerage, market, timezone, settings.
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { ah, parse } = require('../lib/http');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  const workspace = await prisma.workspace.findUnique({ where: { id: req.workspaceId } });
  res.json({ workspace });
}));

const PatchBody = z.object({
  name: z.string().min(1).optional(),
  brokerageName: z.string().nullable().optional(),
  officeName: z.string().nullable().optional(),
  market: z.string().nullable().optional(),
  timezone: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
  settings: z.record(z.any()).optional(),
}).strict();

router.patch('/', ah(async (req, res) => {
  const body = parse(PatchBody, req.body);
  const current = await prisma.workspace.findUnique({ where: { id: req.workspaceId } });
  const data = { ...body };
  if (body.settings) data.settings = { ...(current.settings || {}), ...body.settings };
  const workspace = await prisma.workspace.update({ where: { id: req.workspaceId }, data });
  res.json({ workspace });
}));

module.exports = router;
