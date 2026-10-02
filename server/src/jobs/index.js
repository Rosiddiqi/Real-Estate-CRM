// Background job registry. Every other file in this folder is a job module:
//   module.exports = { name: 'battle-plan-pregen', schedule: '*/30 * * * *', runOnBoot: true, run: async () => {...} }
// (`schedule` is a node-cron expression, evaluated in APP_TIMEZONE.) Drop a
// file here to add a job — never edit this registry.
const fs = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');
const config = require('../config');

const running = new Set();

function wrap(job) {
  return async () => {
    if (running.has(job.name)) return; // never overlap the same job
    running.add(job.name);
    const t0 = Date.now();
    try {
      await job.run();
    } catch (err) {
      console.error(`[jobs] ${job.name} failed:`, err);
    } finally {
      running.delete(job.name);
      const ms = Date.now() - t0;
      if (ms > 5000) console.log(`[jobs] ${job.name} took ${ms}ms`);
    }
  };
}

function start() {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js');
  for (const f of files) {
    let job;
    try { job = require(path.join(dir, f)); } catch (err) { console.error(`[jobs] failed to load ${f}:`, err); continue; }
    if (!job || typeof job.run !== 'function') continue;
    job.name = job.name || f.replace(/\.js$/, '');
    const fn = wrap(job);
    if (job.schedule) cron.schedule(job.schedule, fn, { timezone: config.timezone });
    if (job.intervalMs) setInterval(fn, job.intervalMs).unref();
    if (job.runOnBoot) setTimeout(fn, job.bootDelayMs ?? 4000).unref();
  }
  console.log(`[jobs] ${files.length} job module(s) registered`);
}

module.exports = { start };
