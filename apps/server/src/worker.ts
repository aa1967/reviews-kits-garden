import { workerTick } from './directory/worker';

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
console.log('[Directory worker] Starting ownership checks, monitoring, and notifications.');
while (!stopping) {
  try { await workerTick(); }
  catch (error) { console.error('[Directory worker] Tick failed:', error instanceof Error ? error.name : 'Unknown error'); }
  if (!stopping) await Bun.sleep(5000);
}
process.exit(0);
