import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { auth } from '../../../src/infrastructure/auth/auth';
import { db } from '../../../src/infrastructure/database/db';
import * as s from '../../../src/infrastructure/database/schema';
import { directoryRouter } from '../../../src/directory/router';
import { checkClaim } from '../../../src/directory/claims';
import { leaseMonitor, processMonitor } from '../../../src/directory/worker';
import { clearDatabase } from '../IntegrationSetup';

const app = new Hono().route('/directory', directoryRouter);
type Actor = { id: string; token: string };
let admin: Actor, owner: Actor, reviewer: Actor, other: Actor;
async function actor(email: string): Promise<Actor> {
  const result = await auth.api.signUpEmail({ body: { email, password: 'AdministrationTests!123', name: email.split('@')[0]! } });
  await db.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, result.user.id));
  return { id: result.user.id, token: result.token! };
}
function request(path: string, by?: Actor, method = 'GET', input?: unknown, origin?: string) {
  return app.request('/directory' + path, { method, headers: {
    ...(by ? { Authorization: 'Bearer ' + by.token } : {}),
    ...(input ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}),
  }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
async function listing() {
  const response = await request('/businesses', owner, 'POST', { domain: 'example.com', name: 'Example business', category: 'Software' });
  expect(response.status).toBe(201);
  return await response.json() as { id: string; domain: string; updatedAt: string };
}
async function business(businessId: string) {
  return (await db.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, businessId)))[0]!;
}
async function change(businessId: string, changes: object, by = admin) {
  return request('/moderation/businesses/' + businessId, by, 'PATCH', {
    reason: 'Verified administrative change for this listing.', updatedAt: (await business(businessId)).updatedAt.toISOString(), ...changes,
  });
}
const reviewInput = { title: 'My experience with support', content: 'Support answered my questions carefully and resolved my issue promptly.', rating: 4 };
async function published(siteId: string) {
  const response = await request('/businesses/' + siteId + '/reviews', reviewer, 'POST', reviewInput);
  expect(response.status).toBe(201);
  const review = await response.json() as { id: string };
  const [record] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, review.id));
  expect((await request('/moderation/reviews/' + review.id, admin, 'POST', {
    status: 'published', reason: 'First-hand review complies with publication policy.', updatedAt: record!.updatedAt.toISOString(),
  })).status).toBe(200);
  return review;
}
beforeEach(async () => {
  await clearDatabase();
  await db.execute(sql.raw('TRUNCATE directory_businesses, directory_audit, site_settings CASCADE'));
  admin = await actor('admin@example.test'); owner = await actor('owner@example.test');
  reviewer = await actor('reviewer@example.test'); other = await actor('other@example.test');
});

describe('Business administration', () => {
  test('listing, profile, lifecycle and deletion tools require a current platform administrator', async () => {
    const site = await listing();
    for (const by of [undefined, owner]) {
      const expected = by ? 403 : 401;
      expect((await request('/moderation/businesses', by)).status).toBe(expected);
      expect((await request('/moderation/businesses/' + site.id, by, 'PATCH', { description: 'Changed', reason: 'Administrative change.', updatedAt: site.updatedAt })).status).toBe(expected);
      expect((await request('/moderation/businesses/' + site.id, by, 'DELETE', { confirmDomain: site.domain, reason: 'Remove this listing.', updatedAt: site.updatedAt })).status).toBe(expected);
    }
    await db.update(s.users).set({ isSystemAdmin: false }).where(eq(s.users.id, admin.id));
    expect((await request('/moderation/businesses', admin)).status).toBe(403);
    expect((await change(site.id, { permanentlyClosed: true })).status).toBe(403);
    expect((await business(site.id)).permanentlyClosed).toBe(false);
  });
  test('staff edit public descriptions, names and categories with an audited reason and stale-write protection', async () => {
    const site = await listing();
    const result = await change(site.id, { name: 'Renamed business', description: 'A corrected public description.', category: 'Education' });
    expect(result.status).toBe(200);
    const data = await (await request('/businesses/example.com')).json() as { business: { description: string; name: string; category: string; ownerId?: string } };
    expect(data.business).toMatchObject({ description: 'A corrected public description.', name: 'Renamed business', category: 'Education' });
    expect(data.business.ownerId).toBeUndefined();
    expect((await request('/moderation/businesses/' + site.id, admin, 'PATCH', { name: 'Stale name', reason: 'Outdated administrative change.', updatedAt: site.updatedAt })).status).toBe(409);
    expect((await db.select().from(s.directoryAudit))[0]!.note).toContain('example.com');
    expect((await change(site.id, { description: 'Invalid', reason: '' })).status).toBe(400);
    expect((await change(site.id, { domain: 'different.example.com' })).status).toBe(400);
    expect((await change(site.id, { category: 'Invalid category' })).status).toBe(400);
    expect((await business(site.id)).name).toBe('Renamed business');
  });
  test('owners cannot change lifecycle flags through profile editing; profile edits invalidate an old staff revision', async () => {
    const site = await listing();
    await db.update(s.directoryBusinesses).set({ ownerId: owner.id }).where(eq(s.directoryBusinesses.id, site.id));
    expect((await request('/managed/' + site.id, owner, 'PATCH', {
      name: 'Owner profile edit', description: 'Updated by the verified owner.', category: 'Software', permanentlyClosed: true, reviewsClosed: true, listed: false,
    })).status).toBe(200);
    expect(await business(site.id)).toMatchObject({ permanentlyClosed: false, reviewsClosed: false, listed: true });
    expect((await request('/moderation/businesses/' + site.id, admin, 'PATCH', { description: 'Stale staff edit', reason: 'This revision is no longer current.', updatedAt: site.updatedAt })).status).toBe(409);
  });
  test('closing reviews blocks new submissions and author edits, preserves scores, and permits reports and staff decisions', async () => {
    const site = await listing(), review = await published(site.id);
    expect((await change(site.id, { reviewsClosed: true })).status).toBe(200);
    expect((await request('/businesses/' + site.id + '/reviews', other, 'POST', reviewInput)).status).toBe(403);
    expect((await request('/businesses/' + site.id + '/reviews', admin, 'POST', reviewInput)).status).toBe(403);
    expect((await request('/reviews/' + review.id, reviewer, 'PATCH', { ...reviewInput, rating: 5 })).status).toBe(403);
    const score = await (await request('/scores/example.com')).json() as { business: { reviewsClosed: boolean }; score: { count: number; average: number } };
    expect(score.business.reviewsClosed).toBe(true); expect(score.score).toMatchObject({ count: 1, average: 4 });
    expect(await (await request('/widgets/example.com')).text()).toContain('New reviews are closed');
    const own = await (await request('/me', reviewer)).json() as { reviews: { reviewsClosed: boolean }[] };
    expect(own.reviews[0]!.reviewsClosed).toBe(true);
    expect((await request('/reviews/' + review.id + '/reports', other, 'POST', { reason: 'Please investigate a concern about this review.' })).status).toBe(201);
    const [record] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, review.id));
    expect((await request('/moderation/reviews/' + review.id, admin, 'POST', { status: 'rejected', reason: 'Removed after an independent moderation decision.', updatedAt: record!.updatedAt.toISOString() })).status).toBe(200);
    expect((await request('/reviews/' + review.id + '/reports', reviewer, 'POST', { kind: 'appeal', reason: 'Please reconsider this decision about my experience.' })).status).toBe(201);
    expect((await change(site.id, { reviewsClosed: false })).status).toBe(200);
    expect((await request('/reviews/' + review.id, reviewer, 'PATCH', reviewInput)).status).toBe(200);
    expect((await db.select().from(s.directoryReviews))[0]!.status).not.toBe('published');
  });
  test('permanent closure stops monitoring and pending claims, retains history, and discards an in-flight probe', async () => {
    const site = await listing();
    await published(site.id);
    await db.update(s.directoryBusinesses).set({ ownerId: owner.id }).where(eq(s.directoryBusinesses.id, site.id));
    await db.insert(s.directoryClaims).values({ businessId: site.id, userId: other.id, method: 'dns', token: 'fixture-proof', expiresAt: new Date(Date.now() + 100000) });
    expect((await request('/managed/' + site.id + '/monitor', owner, 'PUT', { url: 'https://example.com/', enabled: true })).status).toBe(200);
    const leased = (await leaseMonitor())!;
    await db.insert(s.directoryChecks).values({ monitorId: leased.id, result: 'down', detail: 'Fixture failed check' });
    await db.insert(s.directoryIncidents).values({ monitorId: leased.id, startedAt: new Date(), confirmedAt: new Date(), reason: 'Fixture outage' });
    let release!: () => void;
    const probe = processMonitor(leased, async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { status: 200, body: 'Fixture response', addresses: ['1.1.1.1'], responseMs: 10, tlsExpiresAt: null };
    });
    for (let attempt = 0; attempt < 1000 && !release; attempt++) await Bun.sleep(1);
    expect(release).toBeDefined();
    try { expect((await change(site.id, { permanentlyClosed: true })).status).toBe(200); }
    finally { release(); await probe; }
    expect(await business(site.id)).toMatchObject({ permanentlyClosed: true, reviewsClosed: true, listed: true });
    expect((await db.select().from(s.directoryMonitors))[0]).toMatchObject({ enabled: false, leaseToken: null, leaseUntil: null });
    expect(await leaseMonitor()).toBeUndefined();
    expect((await db.select().from(s.directoryChecks)).length).toBe(1);
    const [incident] = await db.select().from(s.directoryIncidents);
    expect(incident!.endedAt).not.toBeNull(); expect(incident!.reason).toContain('no recovery observation');
    expect((await db.select().from(s.directoryClaims))[0]!.status).toBe('conflict');
    expect((await request('/managed/' + site.id + '/monitor', owner, 'PUT', { url: 'https://example.com/', enabled: true })).status).toBe(403);
    expect((await change(site.id, { reviewsClosed: false })).status).toBe(400);
    expect(await (await request('/widgets/example.com')).text()).toContain('Permanently closed');
    expect((await change(site.id, { permanentlyClosed: false })).status).toBe(200);
    expect((await business(site.id)).reviewsClosed).toBe(true);
    expect((await db.select().from(s.directoryMonitors))[0]!.enabled).toBe(false);
    expect((await change(site.id, { reviewsClosed: false })).status).toBe(200);
  });
  test('hidden listings cannot accept claims or reviews or restart monitors; restoration keeps monitoring paused', async () => {
    const site = await listing();
    expect((await change(site.id, { listed: false })).status).toBe(200);
    expect((await request('/businesses/example.com')).status).toBe(404);
    expect((await request('/businesses/' + site.id + '/claims', owner, 'POST', { method: 'dns' })).status).toBe(403);
    expect((await request('/businesses/' + site.id + '/reviews', reviewer, 'POST', reviewInput)).status).toBe(403);
    const [pending] = await db.insert(s.directoryClaims).values({ businessId: site.id, userId: owner.id, method: 'dns', token: 'fixture-proof', expiresAt: new Date(Date.now() + 100000) }).returning();
    await checkClaim(pending!, async () => true);
    expect((await business(site.id)).ownerId).toBeNull();
    await db.update(s.directoryBusinesses).set({ ownerId: owner.id }).where(eq(s.directoryBusinesses.id, site.id));
    expect((await request('/managed/' + site.id + '/monitor', owner, 'PUT', { url: 'https://example.com/', enabled: true })).status).toBe(403);
    expect((await change(site.id, { listed: true })).status).toBe(200);
    expect((await request('/businesses/example.com')).status).toBe(200);
  });
  test('permanent deletion requires domain confirmation and removes related data while retaining users and audit evidence', async () => {
    const site = await listing(), review = await published(site.id);
    await db.insert(s.directoryMembers).values({ businessId: site.id, userId: owner.id });
    await db.insert(s.directoryInvites).values({ businessId: site.id, email: 'invite@example.test', tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 100000) });
    await db.insert(s.directoryClaims).values({ businessId: site.id, userId: owner.id, method: 'dns', token: 'fixture-proof', expiresAt: new Date(Date.now() + 100000) });
    await db.insert(s.directoryReports).values({ reviewId: review.id, reporterId: other.id, kind: 'report', reason: 'Please investigate this review.' });
    const [monitor] = await db.insert(s.directoryMonitors).values({ businessId: site.id, url: 'https://example.com/' }).returning();
    await db.insert(s.directoryChecks).values({ monitorId: monitor!.id, result: 'up', detail: 'Fixture check' });
    await db.insert(s.directoryIncidents).values({ monitorId: monitor!.id, startedAt: new Date(), confirmedAt: new Date(), reason: 'Fixture incident' });
    const input = { confirmDomain: 'wrong.example.com', reason: 'Remove an incorrectly created listing.', updatedAt: (await business(site.id)).updatedAt.toISOString() };
    expect((await request('/moderation/businesses/' + site.id, admin, 'DELETE', input)).status).toBe(400);
    expect((await request('/moderation/businesses/' + site.id, admin, 'DELETE', { ...input, confirmDomain: site.domain })).status).toBe(200);
    for (const table of [s.directoryBusinesses, s.directoryReviews, s.directoryReports, s.directoryClaims, s.directoryMembers, s.directoryInvites, s.directoryMonitors, s.directoryChecks, s.directoryIncidents]) {
      expect((await db.select().from(table)).length).toBe(0);
    }
    expect((await db.select().from(s.users)).length).toBe(4);
    const [audit] = await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'business.deleted'));
    expect(audit).toMatchObject({ actorId: admin.id, targetId: site.id });
    expect(audit!.note).toContain('example.com'); expect(audit!.note).toContain('1 reviews');
    for (const path of ['/businesses/example.com', '/scores/example.com', '/widgets/example.com']) expect((await request(path)).status).toBe(404);
  });
  test('concurrent staff changes accept one current revision, and cross-origin changes are rejected', async () => {
    const site = await listing();
    const input = { reason: 'Concurrent administrative correction.', updatedAt: site.updatedAt };
    const responses = await Promise.all(['First', 'Second'].map((name) => request('/moderation/businesses/' + site.id, admin, 'PATCH', { ...input, name })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await request('/moderation/businesses/' + site.id, admin, 'PATCH', { ...input, description: 'Untrusted edit' }, 'https://untrusted.example')).status).toBe(403);
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'business.updated-by-staff'))).length).toBe(1);
  });
  test('staff ownership transfers retain verified-account requirements and revoke previous access and invitations', async () => {
    const site = await listing();
    await db.update(s.directoryBusinesses).set({ ownerId: owner.id }).where(eq(s.directoryBusinesses.id, site.id));
    await db.insert(s.directoryMembers).values([{ businessId: site.id, userId: owner.id }, { businessId: site.id, userId: reviewer.id }]);
    await db.insert(s.directoryInvites).values({ businessId: site.id, email: 'other@example.test', tokenHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 100000) });
    expect((await change(site.id, { ownerEmail: 'missing@example.test' })).status).toBe(400);
    expect((await change(site.id, { ownerEmail: 'other@example.test' })).status).toBe(200);
    expect((await business(site.id)).ownerId).toBe(other.id);
    expect((await db.select().from(s.directoryMembers)).map((member) => member.userId)).toEqual([other.id]);
    expect((await db.select().from(s.directoryInvites)).length).toBe(0);
    expect((await request('/managed/' + site.id, owner)).status).toBe(403);
    expect((await request('/managed/' + site.id, other)).status).toBe(200);
    expect((await request('/moderation/businesses', other)).status).toBe(403);
  });
  test('business search and pagination reach older listings, include hidden businesses, and expose no owner IDs', async () => {
    await db.insert(s.directoryBusinesses).values(Array.from({ length: 105 }, (_, i) => ({
      domain: 'business' + i + '.example.com', name: 'Business ' + i, listed: i !== 0, ownerId: owner.id, createdAt: new Date(Date.now() - i * 1000),
    })));
    const page = await (await request('/moderation/businesses?page=6', admin)).json() as { total: number; businesses: { domain: string; ownerId?: string }[] };
    expect(page.total).toBe(105); expect(page.businesses.length).toBe(5);
    const search = await (await request('/moderation/businesses?q=business104.example.com', admin)).json() as { total: number; businesses: { domain: string; ownerId?: string }[] };
    expect(search.total).toBe(1); expect(search.businesses[0]!.domain).toBe('business104.example.com');
    expect(search.businesses[0]!.ownerId).toBeUndefined();
    const hidden = await (await request('/moderation/businesses?filter=hidden', admin)).json() as { total: number };
    expect(hidden.total).toBe(1);
    expect((await request('/moderation/businesses?filter=invalid', admin)).status).toBe(400);
  });
});

describe('Ruby site theme settings', () => {
  test('dark ruby is the public default; only current staff can save supported site themes', async () => {
    expect(await (await request('/site-settings')).json()).toEqual({ defaultTheme: 'ruby-dark', updatedAt: null });
    const input = { defaultTheme: 'ruby-light', updatedAt: null };
    expect((await request('/moderation/settings', undefined, 'PUT', input)).status).toBe(401);
    expect((await request('/moderation/settings', owner, 'PUT', input)).status).toBe(403);
    expect((await request('/moderation/settings', admin, 'PUT', { ...input, defaultTheme: 'green' })).status).toBe(400);
    expect((await request('/moderation/settings', admin, 'PUT', input)).status).toBe(200);
    const response = await request('/site-settings');
    const result = await response.json() as { defaultTheme: string; updatedAt: string; updatedBy?: string };
    expect(result.defaultTheme).toBe('ruby-light'); expect(result.updatedBy).toBeUndefined();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await request('/moderation/settings', admin, 'PUT', input)).status).toBe(409);
    expect((await request('/moderation/settings', admin, 'PUT', { defaultTheme: 'ruby-dark', updatedAt: result.updatedAt })).status).toBe(200);
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'site.theme-updated'))).length).toBe(2);
  });
  test('simultaneous first-time theme changes cannot silently overwrite one another', async () => {
    const responses = await Promise.all(['ruby-dark', 'ruby-light'].map((defaultTheme) => request('/moderation/settings', admin, 'PUT', { defaultTheme, updatedAt: null })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await db.select().from(s.siteSettings)).length).toBe(1);
    expect((await request('/moderation/settings', admin, 'PUT', { defaultTheme: 'ruby-light', updatedAt: null }, 'https://untrusted.example')).status).toBe(403);
  });
});
