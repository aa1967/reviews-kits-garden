import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';
import { checkClaim, recheckOwnership } from './claims';
import { safeHttpsGet, type ProbeResponse } from './network';
import { monitorTransition } from './monitoring';
import { mailConfigured, sendDirectoryMail } from './mail';

type Monitor = typeof s.directoryMonitors.$inferSelect;

async function notify(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], siteId: string, title: string, message: string) {
  const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, siteId));
  if (!site?.ownerId) return;
  await tx.insert(s.notifications).values({ userId: site.ownerId, type: 'directory.monitor', title, body: message });
  const [owner] = await tx.select().from(s.users).where(eq(s.users.id, site.ownerId));
  if (owner) await tx.insert(s.directoryMail).values({ to: owner.email, subject: title, body: message });
}

export async function leaseMonitor(): Promise<Monitor | undefined> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [monitor] = await tx.select().from(s.directoryMonitors)
      .where(and(eq(s.directoryMonitors.enabled, true), lte(s.directoryMonitors.nextCheckAt, now), or(isNull(s.directoryMonitors.leaseUntil), lt(s.directoryMonitors.leaseUntil, now))))
      .orderBy(s.directoryMonitors.nextCheckAt).limit(1).for('update', { skipLocked: true });
    if (!monitor) return undefined;
    const [leased] = await tx.update(s.directoryMonitors).set({
      leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000),
    }).where(eq(s.directoryMonitors.id, monitor.id)).returning();
    return leased;
  });
}

export async function processMonitor(monitor: Monitor, probe = safeHttpsGet): Promise<void> {
  const [site] = await db.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, monitor.businessId));
  if (!site || !site.listed || !site.ownerId) return;
  let result: 'up' | 'down' | 'unknown' = 'unknown';
  let detail = 'No response';
  let response: ProbeResponse | undefined;
  try {
    response = await probe(monitor.url, site.domain);
    const goodStatus = response.status >= 200 && response.status < 300;
    const goodContent = !monitor.expectedText || response.body.includes(monitor.expectedText);
    result = goodStatus && goodContent ? 'up' : 'down';
    detail = !goodStatus ? 'HTTP ' + response.status : !goodContent ? 'Expected page content was missing' : 'HTTPS check succeeded';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Probe failed';
    // Infrastructure failures, unsafe targets, and DNS ambiguity remain unknown.
    const targetFailure = !/DNS|Unsafe|safety limit/i.test(message) && /timed out|ECONNREFUSED|CERT_|certificate|TLS|ECONNRESET/i.test(message);
    result = targetFailure ? 'down' : 'unknown';
    detail = message.slice(0, 200);
  }
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(s.directoryMonitors).where(eq(s.directoryMonitors.id, monitor.id)).for('update');
    if (!current?.enabled || current.leaseToken !== monitor.leaseToken) return;
    const at = new Date();
    const [incident] = await tx.select().from(s.directoryIncidents).where(and(eq(s.directoryIncidents.monitorId, monitor.id), isNull(s.directoryIncidents.endedAt))).for('update');
    const state = monitorTransition(current, result, at, !!incident);
    if (state.open) {
      await tx.insert(s.directoryIncidents).values({ monitorId: monitor.id, startedAt: state.firstFailureAt ?? at, confirmedAt: at, reason: detail });
      await notify(tx, site.id, site.domain + ' appears down', 'Two checks from our monitoring location failed. First observed failure: ' + (state.firstFailureAt ?? at).toISOString() + '. ' + detail);
    }
    if (state.close && incident) {
      await tx.update(s.directoryIncidents).set({ endedAt: at }).where(eq(s.directoryIncidents.id, incident.id));
      await notify(tx, site.id, site.domain + ' recovered', 'Two recovery checks succeeded. Observed incident began at ' + incident.startedAt.toISOString() + '.');
    }
    const dnsAddresses = response?.addresses.join(',') ?? current.dnsAddresses;
    if (response?.tlsExpiresAt && response.tlsExpiresAt.getTime() < Date.now() + 14 * 86400000 &&
        (!current.tlsExpiresAt || current.tlsExpiresAt.getTime() >= Date.now() + 14 * 86400000)) {
      await notify(tx, site.id, 'Certificate expiring: ' + site.domain, 'The observed TLS certificate expires on ' + response.tlsExpiresAt.toISOString() + '.');
    }
    const dnsChanged = current.dnsAddresses && dnsAddresses && current.dnsAddresses !== dnsAddresses &&
      (!current.lastDnsAlertAt || Date.now() - current.lastDnsAlertAt.getTime() >= 86400000);
    if (dnsChanged) {
      await notify(tx, site.id, 'DNS changed: ' + site.domain, 'The public addresses observed by the monitor changed. This may be expected for a CDN.');
    }
    const widgetInstalled = response ? /reviewskits|\/directory\/widgets\/|\/directory\/embed\.js/i.test(response.body) : current.widgetInstalled;
    if (current.widgetInstalled === true && widgetInstalled === false) await notify(tx, site.id, 'Review widget not detected: ' + site.domain, 'The monitor no longer found the widget in the initial HTML response. JavaScript-only installation may not be visible to this check.');
    await tx.insert(s.directoryChecks).values({ monitorId: monitor.id, result, detail, checkedAt: at, responseMs: response?.responseMs, statusCode: response?.status });
    await tx.update(s.directoryMonitors).set({
      lastResult: result, lastCheckAt: at, responseMs: response?.responseMs ?? null,
      tlsExpiresAt: response?.tlsExpiresAt ?? current.tlsExpiresAt, dnsAddresses, widgetInstalled,
      lastDnsAlertAt: dnsChanged ? at : current.lastDnsAlertAt,
      failureStreak: state.failureStreak, recoveryStreak: state.recoveryStreak, firstFailureAt: state.firstFailureAt,
      nextCheckAt: new Date(at.getTime() + state.retrySeconds * 1000), leaseToken: null, leaseUntil: null,
    }).where(eq(s.directoryMonitors.id, monitor.id));
  });
}

async function processMail(): Promise<void> {
  if (!mailConfigured()) return;
  // Lease by moving nextAttemptAt while locked; delivery is at-least-once.
  const job = await db.transaction(async (tx) => {
    const [mail] = await tx.select().from(s.directoryMail).where(and(isNull(s.directoryMail.sentAt), lt(s.directoryMail.attempts, 8), lte(s.directoryMail.nextAttemptAt, new Date()))).limit(1).for('update', { skipLocked: true });
    if (!mail) return undefined;
    await tx.update(s.directoryMail).set({ attempts: mail.attempts + 1, nextAttemptAt: new Date(Date.now() + 120000) }).where(eq(s.directoryMail.id, mail.id));
    return mail;
  });
  if (!job) return;
  try {
    await sendDirectoryMail(job.to, job.subject, job.body);
    await db.update(s.directoryMail).set({ sentAt: new Date() }).where(eq(s.directoryMail.id, job.id));
  } catch {
    await db.update(s.directoryMail).set({ nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts)) }).where(eq(s.directoryMail.id, job.id));
    console.error('[Directory worker] Email delivery failed; retry scheduled.');
  }
}

let lastCleanup = 0;
export async function workerTick(): Promise<void> {
  await db.insert(s.directoryWorkers).values({ name: 'directory', lastSeenAt: new Date() }).onConflictDoUpdate({ target: s.directoryWorkers.name, set: { lastSeenAt: new Date() } });
  // Claim verification work is leased using nextCheckAt and SKIP LOCKED.
  for (let n = 0; n < 3; n++) {
    const claim = await db.transaction(async (tx) => {
      const [next] = await tx.select().from(s.directoryClaims).where(and(eq(s.directoryClaims.status, 'pending'), lte(s.directoryClaims.nextCheckAt, new Date()))).limit(1).for('update', { skipLocked: true });
      if (!next) return undefined;
      await tx.update(s.directoryClaims).set({ nextCheckAt: new Date(Date.now() + 120000) }).where(eq(s.directoryClaims.id, next.id));
      return next;
    });
    if (claim) await checkClaim(claim);
  }
  // Bound concurrent probes; the lease prevents duplicate work across workers.
  await Promise.all(Array.from({ length: 3 }, async () => {
    const monitor = await leaseMonitor();
    if (monitor) await processMonitor(monitor);
  }));
  await processMail();
  const verified = await db.transaction(async (tx) => {
    const [claim] = await tx.select().from(s.directoryClaims).where(and(eq(s.directoryClaims.status, 'verified'), lte(s.directoryClaims.nextCheckAt, new Date()))).limit(1).for('update', { skipLocked: true });
    if (claim) await tx.update(s.directoryClaims).set({ nextCheckAt: new Date(Date.now() + 120000) }).where(eq(s.directoryClaims.id, claim.id));
    return claim;
  });
  if (verified) await recheckOwnership(verified);
  if (Date.now() - lastCleanup > 3600000) {
    await db.delete(s.directoryChecks).where(lt(s.directoryChecks.checkedAt, new Date(Date.now() - 90 * 86400000)));
    await db.update(s.directoryReviews).set({ networkKey: null }).where(and(lt(s.directoryReviews.createdAt, new Date(Date.now() - 30 * 86400000)), sql.raw('network_key IS NOT NULL')));
    await db.delete(s.directoryMail).where(and(lt(s.directoryMail.createdAt, new Date(Date.now() - 30 * 86400000)), or(lt(s.directoryMail.sentAt, new Date()), gteAttempts())));
    lastCleanup = Date.now();
  }
}

function gteAttempts() { return sql.raw('attempts >= 8'); }
