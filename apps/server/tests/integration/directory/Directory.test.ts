import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '../../../src/infrastructure/auth/auth';
import { db } from '../../../src/infrastructure/database/db';
import * as s from '../../../src/infrastructure/database/schema';
import { directoryRouter } from '../../../src/directory/router';
import { checkClaim, recheckOwnership } from '../../../src/directory/claims';
import { leaseMonitor, processMonitor } from '../../../src/directory/worker';
import { clearDatabase } from '../IntegrationSetup';

const app = new Hono().route('/directory', directoryRouter);
type Actor = { id: string; token: string; email: string };
let admin: Actor, owner: Actor, reviewer: Actor, other: Actor;
async function actor(email: string, verified = true): Promise<Actor> {
  const result = await auth.api.signUpEmail({ body: { email, password: 'DirectoryTests!123', name: email.split('@')[0]!, ...{ isSystemAdmin: true } } });
  await db.update(s.users).set({ emailVerified: verified }).where(eq(s.users.id, result.user.id));
  return { id: result.user.id, token: result.token!, email };
}
function request(path: string, actor?: Actor, method = 'GET', body?: unknown) {
  return app.request('/directory' + path, { method, headers: { ...(actor ? { Authorization: 'Bearer ' + actor.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function listing() {
  const response = await request('/businesses', owner, 'POST', { domain: 'example.com', name: 'Example business', category: 'Software' });
  expect(response.status).toBe(201);
  return await response.json() as { id: string; domain: string };
}
async function claimed() {
  const site = await listing();
  const [claim] = await db.insert(s.directoryClaims).values({ businessId: site.id, userId: owner.id, method: 'dns', token: 'test-proof', expiresAt: new Date(Date.now() + 100000) }).returning();
  await checkClaim(claim!, async () => true);
  return site;
}
async function submit(siteId: string, by = reviewer, rating = 1, content = 'The support team did not respond to my questions about the service.') {
  const response = await request('/businesses/' + siteId + '/reviews', by, 'POST', { title: rating === 1 ? 'Unhelpful support' : 'Helpful support', content, rating, status: 'published', metadata: { networkKey: 'forged' } });
  expect(response.status).toBe(201);
  return await response.json() as { id: string; status: string };
}
async function publish(reviewId: string) {
  const [row] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, reviewId));
  const response = await request('/moderation/reviews/' + reviewId, admin, 'POST', { status: 'published', reason: 'First-hand account meets our publication policy.', updatedAt: row!.updatedAt.toISOString() });
  expect(response.status).toBe(200);
}
beforeEach(async () => {
  await clearDatabase();
  await db.execute(sql.raw('TRUNCATE directory_businesses, directory_audit, directory_mail, directory_workers CASCADE'));
  admin = await actor('staff@example.com');
  owner = await actor('owner@example.com');
  reviewer = await actor('reviewer@example.com');
  other = await actor('other@example.com');
});
describe('Independent directory workflow', () => {
  test('first signup retains platform admin; later signups cannot submit their own admin flag', async () => {
    expect((await db.select().from(s.users).where(eq(s.users.id, admin.id)))[0]!.isSystemAdmin).toBe(true);
    expect((await db.select().from(s.users).where(eq(s.users.id, owner.id)))[0]!.isSystemAdmin).toBe(false);
    expect((await request('/moderation', owner)).status).toBe(403);
    expect((await request('/moderation')).status).toBe(401);
  });
  test('unverified accounts cannot claim a domain or submit reviews', async () => {
    const site = await listing();
    await db.update(s.users).set({ emailVerified: false }).where(eq(s.users.id, reviewer.id));
    expect((await request('/businesses/' + site.id + '/claims', reviewer, 'POST', { method: 'dns' })).status).toBe(403);
    expect((await request('/businesses/' + site.id + '/reviews', reviewer, 'POST', { title: 'Review', content: 'A sufficiently long first hand experience.', rating: 5 })).status).toBe(403);
  });
  test('concurrent successful ownership proofs grant only one owner and never staff access', async () => {
    const site = await listing();
    const [a, b] = await db.insert(s.directoryClaims).values([owner, other].map((u) => ({ businessId: site.id, userId: u.id, method: 'dns' as const, token: u.id, expiresAt: new Date(Date.now() + 100000) }))).returning();
    await Promise.all([checkClaim(a!, async () => true), checkClaim(b!, async () => true)]);
    const claims = await db.select().from(s.directoryClaims);
    expect(claims.map((r) => r.status).sort()).toEqual(['conflict', 'verified']);
    const [business] = await db.select().from(s.directoryBusinesses);
    expect([owner.id, other.id]).toContain(business!.ownerId!);
    expect((await request('/moderation', owner)).status).toBe(403);
  });
  test('expired or missing proof cannot assign ownership', async () => {
    const site = await listing();
    const [claim] = await db.insert(s.directoryClaims).values({ businessId: site.id, userId: owner.id, method: 'file', token: 'not-published', expiresAt: new Date(Date.now() - 1000) }).returning();
    await checkClaim(claim!, async () => true);
    expect((await db.select().from(s.directoryClaims))[0]!.status).toBe('expired');
    expect((await db.select().from(s.directoryBusinesses))[0]!.ownerId).toBe(null);
    const [pending] = await db.insert(s.directoryClaims).values({ businessId: site.id, userId: owner.id, method: 'file', token: 'different-token', expiresAt: new Date(Date.now() + 100000) }).returning();
    await checkClaim(pending!, async () => false);
    expect((await db.select().from(s.directoryBusinesses))[0]!.ownerId).toBe(null);
  });
  test('ownership rechecks allow a grace period, preserve access on resolver failures, and revoke stale invitations', async () => {
    const site = await claimed();
    await request('/managed/' + site.id + '/invites', owner, 'POST', { email: other.email });
    const [verified] = await db.select().from(s.directoryClaims);
    await recheckOwnership(verified!, async () => { throw new Error('Resolver unavailable'); });
    expect((await db.select().from(s.directoryBusinesses))[0]!.ownerId).toBe(owner.id);
    await recheckOwnership(verified!, async () => false);
    expect((await db.select().from(s.directoryBusinesses))[0]!.ownerId).toBe(owner.id);
    const [stale] = await db.update(s.directoryClaims).set({ proofMissingSince: new Date(Date.now() - 8 * 86400000) }).where(eq(s.directoryClaims.id, verified!.id)).returning();
    await recheckOwnership(stale!, async () => false);
    expect((await db.select().from(s.directoryBusinesses))[0]!.ownerId).toBe(null);
    expect((await db.select().from(s.directoryInvites)).length).toBe(0);
    expect((await request('/managed/' + site.id, owner)).status).toBe(403);
  });
  test('businesses can reply but only staff can publish, including negative reviews', async () => {
    const site = await claimed();
    const review = await submit(site.id);
    expect(review.status).toBe('pending');
    expect((await request('/moderation/reviews/' + review.id, owner, 'POST', { status: 'published' })).status).toBe(403);
    expect((await request('/businesses/example.com')).status).toBe(200);
    await publish(review.id);
    const response = await request('/reviews/' + review.id + '/reply', owner, 'POST', { reply: 'We would like to investigate your concern.' });
    expect(response.status).toBe(200);
    const publicData = await (await request('/businesses/example.com')).json() as { score: { average: number }; reviews: { reply: string }[] };
    expect(publicData.score.average).toBe(1);
    expect(publicData.reviews[0]!.reply).toContain('investigate');
    expect(JSON.stringify(publicData)).not.toContain('reviewer@example.com');
    expect((await request('/reviews/' + review.id, owner, 'PATCH', { title: 'Changed', content: 'A replacement account without authorization.', rating: 5 })).status).toBe(404);
  });
  test('highlight selection never changes the overall score and unpublished content stays private', async () => {
    const site = await claimed();
    const bad = await submit(site.id); await publish(bad.id);
    const good = await submit(site.id, other, 5, 'The delivery was fast and every issue was resolved immediately by the team.'); await publish(good.id);
    const html = await (await request('/widgets/example.com?mode=highlights&ids=' + good.id)).text();
    expect(html).toContain('3 / 5'); expect(html).toContain('2 published reviews'); expect(html).toContain('Selected reviews');
    expect(html).toContain('Helpful support'); expect(html).not.toContain('Unhelpful support');
    const hidden = await submit(site.id, owner, 4, 'The company I manage has excellent services and customer support every day.');
    expect(hidden.status).toBe('quarantined');
    expect(await (await request('/widgets/example.com?mode=recent')).text()).not.toContain('company I manage');
  });
  test('review edits return to moderation and stale decisions cannot publish a newer revision', async () => {
    const site = await claimed(), review = await submit(site.id); await publish(review.id);
    const [previous] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, review.id));
    expect((await request('/reviews/' + review.id, reviewer, 'PATCH', { title: 'An updated experience', content: 'The situation has changed after a follow-up conversation with their team.', rating: 3 })).status).toBe(200);
    expect((await (await request('/scores/example.com')).json() as { score: { count: number } }).score.count).toBe(0);
    expect((await request('/moderation/reviews/' + review.id, admin, 'POST', { status: 'published', reason: 'Trying to approve a previous revision.', updatedAt: previous!.updatedAt.toISOString() })).status).toBe(409);
  });
  test('reports and appeals have staff-only resolution and an auditable decision', async () => {
    const site = await claimed(), review = await submit(site.id); await publish(review.id);
    expect((await request('/reviews/' + review.id + '/reports', owner, 'POST', { reason: 'I would like a moderator to check this review.' })).status).toBe(201);
    const [report] = await db.select().from(s.directoryReports);
    expect((await request('/moderation/reports/' + report!.id, owner, 'POST', { resolution: 'Resolve this report.' })).status).toBe(403);
    expect((await request('/moderation/reports/' + report!.id, admin, 'POST', { resolution: 'Review complies with the policy and remains published.' })).status).toBe(200);
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'report.resolved'))).length).toBe(1);
  });
  test('team invitations are email-bound, single-use, and never grant owner permissions', async () => {
    const site = await claimed();
    const created = await request('/managed/' + site.id + '/invites', owner, 'POST', { email: other.email });
    const invitation = await created.json() as { link: string };
    const token = new URL(invitation.link).searchParams.get('invite');
    expect((await request('/invites/accept', reviewer, 'POST', { token })).status).toBe(403);
    expect((await request('/invites/accept', other, 'POST', { token })).status).toBe(200);
    expect((await request('/invites/accept', other, 'POST', { token })).status).toBe(403);
    expect((await request('/managed/' + site.id, other)).status).toBe(200);
    expect((await request('/managed/' + site.id + '/invites', other, 'POST', { email: reviewer.email })).status).toBe(403);
    expect((await request('/managed/' + site.id + '/members/' + other.id, owner, 'DELETE')).status).toBe(200);
    expect((await request('/managed/' + site.id, other)).status).toBe(403);
  });
  test('monitor leases prevent duplicate probes and outages count incidents instead of failures', async () => {
    const site = await claimed();
    expect((await request('/managed/' + site.id + '/monitor', owner, 'PUT', { url: 'https://127.0.0.1/', enabled: true })).status).toBe(400);
    expect((await request('/managed/' + site.id + '/monitor', owner, 'PUT', { url: 'https://example.com/', enabled: true })).status).toBe(200);
    const leases = await Promise.all([leaseMonitor(), leaseMonitor()]);
    expect(leases.filter(Boolean).length).toBe(1);
    const probe = (status: number) => async () => ({ status, body: 'Hello', responseMs: 15, tlsExpiresAt: null, addresses: ['1.1.1.1'] });
    await processMonitor(leases.find(Boolean)!, probe(500));
    async function run(status: number) {
      await db.update(s.directoryMonitors).set({ nextCheckAt: new Date(0) }).where(eq(s.directoryMonitors.businessId, site.id));
      await processMonitor((await leaseMonitor())!, probe(status));
    }
    await run(500); await run(500);
    expect((await db.select().from(s.directoryIncidents)).length).toBe(1);
    await run(200); expect((await db.select().from(s.directoryIncidents))[0]!.endedAt).toBe(null);
    await run(200); expect((await db.select().from(s.directoryIncidents))[0]!.endedAt).not.toBe(null);
    expect((await db.select().from(s.directoryChecks)).length).toBe(5);
  });
  test('only staff can access account links and browser-supplied evidence is ignored', async () => {
    const site = await claimed(), first = await submit(site.id);
    await submit(site.id, other, 1);
    expect((await request('/moderation/reviews/' + first.id + '/evidence', owner)).status).toBe(403);
    const evidence = await (await request('/moderation/reviews/' + first.id + '/evidence', admin)).json() as { possibleConnections: unknown[] };
    expect(evidence.possibleConnections.length).toBe(1);
    const [review] = await db.select().from(s.directoryReviews).where(and(eq(s.directoryReviews.id, first.id)));
    expect(review!.networkKey).toBe(null);
  });
});
