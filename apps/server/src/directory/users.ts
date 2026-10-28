import type { Hono } from 'hono';
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { donationDisplayAmount } from '@reviewskits/types';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';
import { accountFail as fail, accountId, profileIdentity, type AccountHelpers } from './account';
import { avatarUrl, profilePseudonym } from './identity';
import { nextBusinessVersion } from './administration';

const fields = {
  id: s.users.id, name: s.users.name, email: s.users.email, emailVerified: s.users.emailVerified, image: s.users.image,
  isSystemAdmin: s.users.isSystemAdmin, suspendedAt: s.users.suspendedAt, suspensionReason: s.users.suspensionReason,
  createdAt: s.users.createdAt, updatedAt: s.users.updatedAt, lastSignInAt: s.users.lastSignInAt, pseudonym: s.userProfiles.pseudonym,
  reviewCount: sql<number>`(select count(*)::int from directory_reviews r where r.reviewer_id = ${s.users.id})`,
  businessCount: sql<number>`(select count(*)::int from directory_businesses b where b.owner_id = ${s.users.id})`,
  riskCount: sql<number>`(select count(*)::int from directory_reviews r where r.reviewer_id = ${s.users.id} and r.risk_score >= 60)`,
};
async function lockAdministrator(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actorId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(972403)`);
  const [actor] = await tx.select().from(s.users).where(eq(s.users.id, actorId));
  if (!actor?.isSystemAdmin || actor.suspendedAt) fail(403, 'Administrator access is no longer available.');
}
export function registerUserAdministration(router: Hono, { staff, body }: AccountHelpers) {
  router.get('/moderation/users', async (c) => {
    await staff(c);
    const q = (c.req.query('q') ?? '').slice(0, 120).replace(/[%_\\]/g, '\\$&');
    const filter = c.req.query('filter') ?? 'all';
    if (!['all', 'active', 'suspended', 'admins'].includes(filter)) fail(400, 'Invalid account filter.');
    const page = Math.min(100000, Math.max(1, Math.floor(Number(c.req.query('page')) || 1)));
    const where = and(q ? or(ilike(s.users.name, '%' + q + '%'), ilike(s.users.email, '%' + q + '%'), ilike(s.userProfiles.pseudonym, '%' + q + '%')) : undefined,
      filter === 'active' ? isNull(s.users.suspendedAt) : filter === 'suspended' ? sql`${s.users.suspendedAt} is not null` : filter === 'admins' ? eq(s.users.isSystemAdmin, true) : undefined);
    const users = await db.select(fields).from(s.users).leftJoin(s.userProfiles, eq(s.userProfiles.userId, s.users.id)).where(where)
      .orderBy(desc(s.users.createdAt), s.users.id).limit(20).offset((page - 1) * 20);
    const [total] = await db.select({ count: count() }).from(s.users).leftJoin(s.userProfiles, eq(s.userProfiles.userId, s.users.id)).where(where);
    return c.json({ users: users.map((row) => ({ ...row, image: avatarUrl(row.image) })), total: Number(total!.count), page });
  });
  router.get('/moderation/users/:id', async (c) => {
    await staff(c); const userId = accountId(c.req.param('id'));
    const [actor] = await db.select().from(s.users).where(eq(s.users.id, userId));
    if (!actor) fail(404, 'Account not found.');
    const [summary] = await db.select(fields).from(s.users).leftJoin(s.userProfiles, eq(s.userProfiles.userId, s.users.id)).where(eq(s.users.id, userId));
    const page = Math.min(100000, Math.max(1, Math.floor(Number(c.req.query('reviewPage')) || 1)));
    const reviews = await db.select({
      id: s.directoryReviews.id, domain: s.directoryBusinesses.domain, title: s.directoryReviews.title, rating: s.directoryReviews.rating,
      status: s.directoryReviews.status, anonymous: s.directoryReviews.anonymous, riskScore: s.directoryReviews.riskScore, riskReasons: s.directoryReviews.riskReasons, createdAt: s.directoryReviews.createdAt,
    }).from(s.directoryReviews).innerJoin(s.directoryBusinesses, eq(s.directoryBusinesses.id, s.directoryReviews.businessId))
      .where(eq(s.directoryReviews.reviewerId, userId)).orderBy(desc(s.directoryReviews.createdAt)).limit(20).offset((page - 1) * 20);
    const businesses = await db.select({ id: s.directoryBusinesses.id, domain: s.directoryBusinesses.domain, name: s.directoryBusinesses.name,
      role: sql<'owner' | 'member'>`case when ${s.directoryBusinesses.ownerId} = ${userId} then 'owner' else 'member' end` })
      .from(s.directoryBusinesses).where(or(eq(s.directoryBusinesses.ownerId, userId), sql`exists(select 1 from directory_members m where m.business_id = ${s.directoryBusinesses.id} and m.user_id = ${userId})`))
      .orderBy(s.directoryBusinesses.domain).limit(100);
    const donations = await db.select().from(s.donations).where(eq(s.donations.userId, userId)).orderBy(desc(s.donations.createdAt)).limit(30);
    const sessions = await db.select({ id: s.sessions.id, createdAt: s.sessions.createdAt, expiresAt: s.sessions.expiresAt }).from(s.sessions)
      .where(and(eq(s.sessions.userId, userId), sql`${s.sessions.expiresAt} > now()`)).orderBy(desc(s.sessions.createdAt)).limit(30);
    const audit = await db.select({ id: s.directoryAudit.id, action: s.directoryAudit.action, note: s.directoryAudit.note, createdAt: s.directoryAudit.createdAt }).from(s.directoryAudit)
      .where(or(eq(s.directoryAudit.actorId, userId), eq(s.directoryAudit.targetId, userId))).orderBy(desc(s.directoryAudit.createdAt)).limit(50);
    return c.json({ user: { ...summary!, image: avatarUrl(summary!.image) }, identity: await profileIdentity(actor!), reviews, businesses, sessions, audit,
      donations: donations.map((row) => ({ id: row.id, currency: row.currency, status: row.status, amount: row.confirmedAtomic ? donationDisplayAmount(row.currency, row.confirmedAtomic) : null, publicCredit: row.publicCredit, createdAt: row.createdAt })) });
  });
  router.patch('/moderation/users/:id', async (c) => {
    const actor = await staff(c), targetId = accountId(c.req.param('id'));
    const input = await body(c, z.object({
      name: z.string().trim().min(2).max(80).optional(), mode: z.enum(['account', 'pseudonym']).optional(), pseudonym: z.string().max(80).nullable().optional(),
      defaultAnonymousReviews: z.boolean().optional(), isSystemAdmin: z.boolean().optional(), suspended: z.boolean().optional(),
      removeAvatar: z.boolean().optional(),
      reason: z.string().trim().min(5).max(2000), updatedAt: z.string().datetime(),
    }).strict());
    await db.transaction(async (tx) => {
      await lockAdministrator(tx, actor.id);
      const [target] = await tx.select().from(s.users).where(eq(s.users.id, targetId)).for('update');
      if (!target) fail(404, 'Account not found.');
      if (target.updatedAt.toISOString() !== input.updatedAt) fail(409, 'This account changed. Reload before saving.');
      if (targetId === actor.id && (input.suspended === true || input.isSystemAdmin === false)) fail(400, 'Use another administrator to change your own administrative access.');
      const nextAdmin = input.isSystemAdmin ?? target.isSystemAdmin;
      const suspended = input.suspended ?? !!target.suspendedAt;
      if (target.isSystemAdmin && !target.suspendedAt && (!nextAdmin || suspended)) {
        const [active] = await tx.select({ count: count() }).from(s.users).where(and(eq(s.users.isSystemAdmin, true), isNull(s.users.suspendedAt)));
        if (Number(active!.count) <= 1) fail(409, 'Keep at least one active administrator.');
      }
      const [existing] = await tx.select().from(s.userProfiles).where(eq(s.userProfiles.userId, targetId));
      let pseudonym = input.pseudonym === undefined ? existing?.pseudonym ?? null : input.pseudonym;
      try { if (pseudonym) pseudonym = profilePseudonym(pseudonym); }
      catch (error) { fail(400, (error as Error).message); }
      const mode = input.mode ?? existing?.nameMode ?? 'account';
      if (mode === 'pseudonym' && !pseudonym) fail(400, 'A public pseudonym is required for this identity mode.');
      await tx.update(s.users).set({ ...(input.name ? { name: input.name } : {}), isSystemAdmin: nextAdmin,
        ...(input.removeAvatar ? { image: null } : {}),
        suspendedAt: suspended ? target.suspendedAt ?? new Date() : null, suspensionReason: suspended ? input.reason : null,
        updatedAt: nextBusinessVersion(target.updatedAt) }).where(eq(s.users.id, targetId));
      await tx.insert(s.userProfiles).values({ userId: targetId, nameMode: mode, pseudonym, defaultAnonymousReviews: input.defaultAnonymousReviews ?? existing?.defaultAnonymousReviews ?? false })
        .onConflictDoUpdate({ target: s.userProfiles.userId, set: { nameMode: mode, pseudonym, defaultAnonymousReviews: input.defaultAnonymousReviews ?? existing?.defaultAnonymousReviews ?? false } });
      if (suspended || nextAdmin !== target.isSystemAdmin) await tx.delete(s.sessions).where(eq(s.sessions.userId, targetId));
      if (suspended) await tx.update(s.apiKeys).set({ isActive: false }).where(eq(s.apiKeys.userId, targetId));
      if (input.removeAvatar) await tx.delete(s.profileAvatars).where(eq(s.profileAvatars.userId, targetId));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.updated-by-staff', targetId, note: JSON.stringify({ name: input.name, mode, pseudonym,
        isSystemAdmin: nextAdmin, suspended, removeAvatar: input.removeAvatar, defaultAnonymousReviews: input.defaultAnonymousReviews }) + ': ' + input.reason });
    });
    return c.json({ success: true });
  });
  router.post('/moderation/users/:id/revoke-sessions', async (c) => {
    const actor = await staff(c), targetId = accountId(c.req.param('id'));
    const input = await body(c, z.object({ reason: z.string().trim().min(5).max(2000), updatedAt: z.string().datetime() }).strict());
    await db.transaction(async (tx) => {
      await lockAdministrator(tx, actor.id);
      const [target] = await tx.select().from(s.users).where(eq(s.users.id, targetId)).for('update');
      if (!target) fail(404, 'Account not found.');
      if (target.updatedAt.toISOString() !== input.updatedAt) fail(409, 'This account changed. Reload before continuing.');
      await tx.delete(s.sessions).where(eq(s.sessions.userId, targetId));
      await tx.update(s.users).set({ updatedAt: nextBusinessVersion(target.updatedAt) }).where(eq(s.users.id, targetId));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.sessions-revoked', targetId, note: input.reason });
    });
    return c.json({ success: true });
  });
  router.delete('/moderation/users/:id', async (c) => {
    const actor = await staff(c), targetId = accountId(c.req.param('id'));
    const input = await body(c, z.object({ confirmEmail: z.string().max(254), reason: z.string().trim().min(5).max(2000), updatedAt: z.string().datetime() }).strict());
    if (targetId === actor.id) fail(400, 'You cannot delete your own administrator account here.');
    await db.transaction(async (tx) => {
      await lockAdministrator(tx, actor.id);
      const [target] = await tx.select().from(s.users).where(eq(s.users.id, targetId)).for('update');
      if (!target) fail(404, 'Account not found.');
      if (target.updatedAt.toISOString() !== input.updatedAt) fail(409, 'This account changed. Reload before deleting.');
      if (target.email !== input.confirmEmail) fail(400, 'Type the exact account email to confirm deletion.');
      if (target.isSystemAdmin) {
        const [active] = await tx.select({ count: count() }).from(s.users).where(and(eq(s.users.isSystemAdmin, true), isNull(s.users.suspendedAt)));
        if (!target.suspendedAt && Number(active!.count) <= 1) fail(409, 'Keep at least one active administrator.');
      }
      const owned = await tx.select({ id: s.directoryBusinesses.id }).from(s.directoryBusinesses).where(eq(s.directoryBusinesses.ownerId, targetId)).for('update');
      if (owned.length) {
        const ids = owned.map((row) => row.id);
        await tx.delete(s.directoryMembers).where(inArray(s.directoryMembers.businessId, ids));
        await tx.delete(s.directoryInvites).where(inArray(s.directoryInvites.businessId, ids));
        await tx.update(s.directoryMonitors).set({ enabled: false, leaseToken: null, leaseUntil: null }).where(inArray(s.directoryMonitors.businessId, ids));
      }
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.deleted', targetId, note: 'Account and its reviews deleted; verified donation ledger retained without account attribution. ' + input.reason });
      await tx.delete(s.users).where(eq(s.users.id, targetId));
    });
    return c.json({ success: true });
  });
}
