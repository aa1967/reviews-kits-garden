import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { auth } from '../../../src/infrastructure/auth/auth';
import { db } from '../../../src/infrastructure/database/db';
import * as s from '../../../src/infrastructure/database/schema';
import { directoryRouter } from '../../../src/directory/router';
import { meRouter } from '../../../src/interface/routes/me';
import { clearDatabase } from '../IntegrationSetup';

const app = new Hono().route('/directory', directoryRouter).route('/legacy-me', meRouter);
type Actor = { id: string; token: string; email: string };
let admin: Actor, target: Actor, other: Actor;
async function actor(email: string): Promise<Actor> {
  const result = await auth.api.signUpEmail({ body: { email, name: email.split('@')[0]!, password: 'Users-Fixture-7439' } });
  await db.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, result.user.id));
  return { id: result.user.id, token: result.token!, email };
}
function request(path: string, by?: Actor, method = 'GET', input?: unknown) {
  return app.request('/directory' + path, { method, headers: { ...(by ? { Authorization: 'Bearer ' + by.token } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
async function record(by = target) { return (await db.select().from(s.users).where(eq(s.users.id, by.id)))[0]!; }
async function change(input: object, by = admin, selected = target) {
  return request('/moderation/users/' + selected.id, by, 'PATCH', { reason: 'Reviewed this account and its activity.', updatedAt: (await record(selected)).updatedAt.toISOString(), ...input });
}
beforeEach(async () => {
  await clearDatabase(); await db.execute(sql.raw('TRUNCATE directory_businesses, directory_audit CASCADE'));
  admin = await actor('admin@example.test'); target = await actor('target@example.test'); other = await actor('other@example.test');
});
describe('Account administration', () => {
  test('all account-management endpoints require current staff access and never return session tokens or password hashes', async () => {
    for (const by of [undefined, target]) {
      const status = by ? 403 : 401;
      expect((await request('/moderation/users', by)).status).toBe(status);
      expect((await request('/moderation/users/' + target.id, by)).status).toBe(status);
      expect((await request('/moderation/users/' + target.id, by, 'PATCH', {})).status).toBe(status);
      expect((await request('/moderation/users/' + target.id + '/revoke-sessions', by, 'POST', {})).status).toBe(status);
      expect((await request('/moderation/users/' + target.id, by, 'DELETE', {})).status).toBe(status);
    }
    const response = await request('/moderation/users/' + target.id, admin), text = await response.text();
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(text).not.toContain(target.token); expect(text).not.toContain('password'); expect(text).not.toContain('ipAddress');
    expect((await record()).lastSignInAt).not.toBeNull();
  });
  test('staff can find users by pseudonym, inspect linked content and update profiles without granting business owners staff access', async () => {
    await db.insert(s.userProfiles).values({ userId: target.id, nameMode: 'pseudonym', pseudonym: 'FindMyRuby' });
    const [site] = await db.insert(s.directoryBusinesses).values({ domain: 'example.com', name: 'Fixture business', ownerId: target.id }).returning();
    await db.insert(s.directoryReviews).values({ businessId: site!.id, reviewerId: target.id, title: 'Fixture review', content: 'A genuine first-hand fixture experience.', rating: 2, fingerprint: 'a'.repeat(64), riskScore: 70, riskReasons: ['Investigation fixture'], anonymous: true });
    const found = await (await request('/moderation/users?q=findmyruby', admin)).json() as { users: { id: string; reviewCount: number; riskCount: number; businessCount: number }[]; total: number };
    expect(found.total).toBe(1); expect(found.users[0]).toMatchObject({ id: target.id, reviewCount: 1, riskCount: 1, businessCount: 1 });
    const detail = await (await request('/moderation/users/' + target.id, admin)).json() as { reviews: { anonymous: boolean }[]; businesses: { role: string }[] };
    expect(detail.reviews[0]!.anonymous).toBe(true); expect(detail.businesses[0]!.role).toBe('owner');
    expect((await change({ name: 'Corrected display', mode: 'pseudonym', pseudonym: 'NewRubyAlias', defaultAnonymousReviews: true })).status).toBe(200);
    expect((await record()).name).toBe('Corrected display');
    expect((await db.select().from(s.userProfiles))[0]).toMatchObject({ pseudonym: 'NewRubyAlias', defaultAnonymousReviews: true });
    const [avatar] = await db.insert(s.profileAvatars).values({ userId: target.id, png: 'fixture' }).returning();
    await db.update(s.users).set({ image: '/api/v1/directory/avatars/' + avatar!.id }).where(eq(s.users.id, target.id));
    expect((await change({ removeAvatar: true })).status).toBe(200);
    expect((await record()).image).toBeNull();
    expect((await db.select().from(s.profileAvatars)).length).toBe(0);
    expect((await request('/moderation/users', target)).status).toBe(403);
  });
  test('suspension revokes sessions, disables API keys, blocks sign-in and protects both directory and original workspace APIs', async () => {
    await db.insert(s.apiKeys).values({ userId: target.id, keyHash: 'a'.repeat(64), keyPrefix: 'pk_test', type: 'public', isActive: true });
    expect((await change({ suspended: true })).status).toBe(200);
    expect((await record()).suspendedAt).not.toBeNull();
    expect((await db.select().from(s.sessions).where(eq(s.sessions.userId, target.id))).length).toBe(0);
    expect((await db.select().from(s.apiKeys))[0]!.isActive).toBe(false);
    expect((await request('/account', target)).status).toBe(401);
    expect((await app.request('/legacy-me', { headers: { Authorization: 'Bearer ' + target.token } })).status).toBe(401);
    await expect(auth.api.signInEmail({ body: { email: target.email, password: 'Users-Fixture-7439' } })).rejects.toMatchObject({ statusCode: 403 });
    expect((await change({ suspended: false })).status).toBe(200);
    const signedIn = await auth.api.signInEmail({ body: { email: target.email, password: 'Users-Fixture-7439' } });
    expect(signedIn.token).toBeDefined();
    expect((await db.select().from(s.apiKeys))[0]!.isActive).toBe(false);
  });
  test('role changes invalidate prior sessions, and self-demotion or suspension cannot lock out the sole administrator', async () => {
    expect((await change({ isSystemAdmin: false }, admin, admin)).status).toBe(400);
    expect((await change({ suspended: true }, admin, admin)).status).toBe(400);
    expect((await request('/moderation/users/' + admin.id, admin, 'DELETE', { confirmEmail: admin.email, reason: 'Attempt self-deletion.', updatedAt: (await record(admin)).updatedAt.toISOString() })).status).toBe(400);
    expect((await change({ isSystemAdmin: true })).status).toBe(200);
    expect((await request('/moderation/users', target)).status).toBe(401);
    const elevated = await auth.api.signInEmail({ body: { email: target.email, password: 'Users-Fixture-7439' } });
    const elevatedActor = { ...target, token: elevated.token! };
    expect((await request('/moderation/users', elevatedActor)).status).toBe(200);
    expect((await change({ isSystemAdmin: false })).status).toBe(200);
    expect((await request('/moderation/users', elevatedActor)).status).toBe(401);
    expect((await record(admin)).isSystemAdmin).toBe(true);
  });
  test('session revocation and profile changes require a current revision and an explanation', async () => {
    const version = (await record()).updatedAt.toISOString();
    expect((await change({ reason: '' })).status).toBe(400);
    expect((await change({ name: 'Updated account' })).status).toBe(200);
    expect((await request('/moderation/users/' + target.id, admin, 'PATCH', { name: 'Stale name', reason: 'Outdated change.', updatedAt: version })).status).toBe(409);
    expect((await request('/moderation/users/' + target.id + '/revoke-sessions', admin, 'POST', { reason: 'Force a fresh sign-in after investigation.', updatedAt: (await record()).updatedAt.toISOString() })).status).toBe(200);
    expect((await db.select().from(s.sessions).where(eq(s.sessions.userId, target.id))).length).toBe(0);
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'account.sessions-revoked'))).length).toBe(1);
  });
  test('deleting an account requires email confirmation and preserves anonymous donation totals and business listings', async () => {
    const [site] = await db.insert(s.directoryBusinesses).values({ domain: 'example.com', name: 'Retained business', ownerId: target.id }).returning();
    await db.insert(s.directoryMembers).values([{ businessId: site!.id, userId: target.id }, { businessId: site!.id, userId: other.id }]);
    await db.insert(s.directoryMonitors).values({ businessId: site!.id, url: 'https://example.com/', enabled: true });
    await db.insert(s.directoryReviews).values({ businessId: site!.id, reviewerId: target.id, title: 'Removed account review', content: 'A fixture review to delete with its author.', rating: 2, fingerprint: 'a'.repeat(64), status: 'published' });
    await db.insert(s.userProfiles).values({ userId: target.id, pseudonym: 'DeletedRuby' });
    await db.insert(s.profileAvatars).values({ userId: target.id, png: 'fixture' });
    await db.insert(s.donations).values({ userId: target.id, currency: 'BTC', walletAddress: 'fixture', declaredAtomic: '12000', confirmedAtomic: '12000', publicCredit: true, status: 'confirmed', transactionId: 'b'.repeat(64), receivedAt: new Date(), confirmedAt: new Date() });
    const input = { reason: 'Remove the account after an independent investigation.', updatedAt: (await record()).updatedAt.toISOString(), confirmEmail: 'wrong@example.test' };
    expect((await request('/moderation/users/' + target.id, admin, 'DELETE', input)).status).toBe(400);
    expect((await request('/moderation/users/' + target.id, admin, 'DELETE', { ...input, confirmEmail: target.email })).status).toBe(200);
    expect(await record()).toBeUndefined();
    expect((await db.select().from(s.directoryReviews)).length).toBe(0);
    expect((await db.select().from(s.profileAvatars)).length).toBe(0);
    expect((await db.select().from(s.directoryMembers)).length).toBe(0);
    expect((await db.select().from(s.directoryBusinesses))[0]!.ownerId).toBeNull();
    expect((await db.select().from(s.directoryMonitors))[0]!.enabled).toBe(false);
    const [donation] = await db.select().from(s.donations);
    expect(donation!.userId).toBeNull(); expect(donation!.confirmedAtomic).toBe('12000');
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'account.deleted'))).length).toBe(1);
  });
});
