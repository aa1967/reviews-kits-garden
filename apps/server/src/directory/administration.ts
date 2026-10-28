import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SITE_THEMES, type SiteSettings } from '@reviewskits/types';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';

type Actor = typeof s.users.$inferSelect;
type Business = typeof s.directoryBusinesses.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Helpers = {
  staff: (c: Context) => Promise<Actor>;
  body: <T extends z.ZodType>(c: Context, schema: T) => Promise<z.infer<T>>;
  publicBusiness: (site: Business) => object;
};
export const businessCategories = ['Software', 'Shopping', 'Professional services', 'Education', 'Travel', 'Health', 'Other'] as const;
const settingsTarget = '00000000-0000-4000-8000-000000000001';
const reason = z.string().trim().min(5).max(2000);
function fail(status: 400 | 403 | 404 | 409, message: string): never { throw new HTTPException(status, { message }); }
function identifier(value: string) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) fail(400, 'Invalid business identifier.');
  return parsed.data!;
}
export function nextBusinessVersion(previous: Date) { return new Date(Math.max(Date.now(), previous.getTime() + 1)); }
function fresh(site: Business, expected: string) {
  if (site.updatedAt.getTime() !== new Date(expected).getTime()) fail(409, 'This business changed. Refresh before saving.');
}
export function requireOpenReviews(site: Business) {
  if (!site.listed) fail(403, 'This listing is unavailable.');
  if (site.reviewsClosed || site.permanentlyClosed) fail(403, 'Reviews are closed for this business. Published reviews remain available.');
}
async function pauseMonitoring(tx: Transaction, businessId: string) {
  const [monitor] = await tx.update(s.directoryMonitors).set({
    enabled: false, leaseToken: null, leaseUntil: null, failureStreak: 0, recoveryStreak: 0, firstFailureAt: null,
  }).where(eq(s.directoryMonitors.businessId, businessId)).returning();
  if (monitor) await tx.update(s.directoryIncidents).set({
    endedAt: new Date(),
    reason: sql`${s.directoryIncidents.reason} || ' [Monitoring stopped administratively; no recovery observation]'`,
  }).where(and(eq(s.directoryIncidents.monitorId, monitor.id), isNull(s.directoryIncidents.endedAt)));
}
async function settings(): Promise<SiteSettings> {
  const [row] = await db.select().from(s.siteSettings).where(eq(s.siteSettings.id, 'global'));
  return { defaultTheme: row?.defaultTheme ?? 'ruby-dark', updatedAt: row?.updatedAt.toISOString() ?? null };
}

export function registerAdministrationRoutes(router: Hono, { staff, body, publicBusiness }: Helpers) {
  router.use('/moderation/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  router.get('/site-settings', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await settings());
  });
  router.put('/moderation/settings', async (c) => {
    const actor = await staff(c);
    const input = await body(c, z.object({ defaultTheme: z.enum(SITE_THEMES), updatedAt: z.string().datetime().nullable() }).strict());
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(972402)`);
      const [current] = await tx.select().from(s.siteSettings).where(eq(s.siteSettings.id, 'global')).for('update');
      if ((current?.updatedAt.toISOString() ?? null) !== input.updatedAt) fail(409, 'Site settings changed. Refresh before saving.');
      const [saved] = await tx.insert(s.siteSettings).values({
        defaultTheme: input.defaultTheme, updatedBy: actor.id, updatedAt: current ? nextBusinessVersion(current.updatedAt) : new Date(),
      }).onConflictDoUpdate({ target: s.siteSettings.id, set: {
        defaultTheme: input.defaultTheme, updatedBy: actor.id, updatedAt: current ? nextBusinessVersion(current.updatedAt) : new Date(),
      } }).returning();
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'site.theme-updated', targetId: settingsTarget, note: 'Default theme changed to ' + input.defaultTheme });
      return { defaultTheme: saved!.defaultTheme, updatedAt: saved!.updatedAt.toISOString() };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  });
  router.get('/moderation/businesses', async (c) => {
    await staff(c);
    c.header('Cache-Control', 'no-store');
    const q = (c.req.query('q') ?? '').slice(0, 120).replace(/[%_\\]/g, '\\$&');
    const filter = c.req.query('filter') ?? 'all';
    if (!['all', 'listed', 'hidden', 'closed', 'reviews-closed'].includes(filter)) fail(400, 'Invalid business filter.');
    const parsedPage = Number(c.req.query('page') ?? 1);
    const page = Math.min(100000, Math.max(1, Number.isFinite(parsedPage) ? Math.floor(parsedPage) : 1));
    const where = and(
      q ? or(ilike(s.directoryBusinesses.name, '%' + q + '%'), ilike(s.directoryBusinesses.domain, '%' + q + '%')) : undefined,
      filter === 'listed' ? eq(s.directoryBusinesses.listed, true) : filter === 'hidden' ? eq(s.directoryBusinesses.listed, false)
        : filter === 'closed' ? eq(s.directoryBusinesses.permanentlyClosed, true) : filter === 'reviews-closed' ? eq(s.directoryBusinesses.reviewsClosed, true) : undefined,
    );
    const rows = await db.select().from(s.directoryBusinesses).where(where).orderBy(desc(s.directoryBusinesses.createdAt), s.directoryBusinesses.id).limit(20).offset((page - 1) * 20);
    const [total] = await db.select({ count: count() }).from(s.directoryBusinesses).where(where);
    return c.json({ businesses: rows.map((site) => ({ ...publicBusiness(site), listed: site.listed })), total: Number(total!.count), page });
  });
  router.patch('/moderation/businesses/:id', async (c) => {
    const actor = await staff(c), businessId = identifier(c.req.param('id'));
    const input = await body(c, z.object({
      name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(2000).optional(), category: z.enum(businessCategories).optional(),
      listed: z.boolean().optional(), permanentlyClosed: z.boolean().optional(), reviewsClosed: z.boolean().optional(),
      ownerEmail: z.string().email().optional(), reason, updatedAt: z.string().datetime(),
    }).strict().refine((value) => Object.keys(value).some((key) => !['reason', 'updatedAt'].includes(key)), 'Choose a change to save.'));
    await db.transaction(async (tx) => {
      const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, businessId)).for('update');
      if (!site) fail(404, 'Business not found.');
      fresh(site!, input.updatedAt);
      const permanentlyClosed = input.permanentlyClosed ?? site!.permanentlyClosed;
      const reviewsClosed = input.reviewsClosed ?? (permanentlyClosed || site!.reviewsClosed);
      if (permanentlyClosed && !reviewsClosed) fail(400, 'Reopen the business before reopening reviews.');
      let newOwnerId: string | undefined;
      if (input.ownerEmail) {
        const [newOwner] = await tx.select().from(s.users).where(eq(s.users.email, input.ownerEmail.toLowerCase()));
        if (!newOwner?.emailVerified) fail(400, 'The new owner must have a verified account.');
        newOwnerId = newOwner!.id;
        await tx.delete(s.directoryMembers).where(eq(s.directoryMembers.businessId, businessId));
        await tx.delete(s.directoryInvites).where(eq(s.directoryInvites.businessId, businessId));
        await tx.update(s.directoryClaims).set({ status: 'conflict' }).where(and(eq(s.directoryClaims.businessId, businessId), eq(s.directoryClaims.status, 'pending')));
        await tx.insert(s.directoryMembers).values({ businessId, userId: newOwnerId });
      }
      const { reason: note, updatedAt: _version, ownerEmail: _email, ...changes } = input;
      await tx.update(s.directoryBusinesses).set({
        ...changes, permanentlyClosed, reviewsClosed, updatedAt: nextBusinessVersion(site!.updatedAt),
        ...(newOwnerId ? { ownerId: newOwnerId, claimedAt: new Date() } : {}),
      }).where(eq(s.directoryBusinesses.id, businessId));
      if (permanentlyClosed || input.listed === false) {
        await pauseMonitoring(tx, businessId);
        await tx.update(s.directoryClaims).set({ status: 'conflict', lastError: 'This listing is unavailable for new ownership claims. Contact platform support.' })
          .where(and(eq(s.directoryClaims.businessId, businessId), eq(s.directoryClaims.status, 'pending')));
      }
      const summary = JSON.stringify({ ...changes, permanentlyClosed, reviewsClosed, ...(newOwnerId ? { ownerId: newOwnerId } : {}) });
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'business.updated-by-staff', targetId: businessId, note: site!.domain + ' ' + summary + ': ' + note });
    });
    return c.json({ success: true });
  });
  router.delete('/moderation/businesses/:id', async (c) => {
    const actor = await staff(c), businessId = identifier(c.req.param('id'));
    const input = await body(c, z.object({ confirmDomain: z.string().max(253), reason, updatedAt: z.string().datetime() }).strict());
    await db.transaction(async (tx) => {
      const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, businessId)).for('update');
      if (!site) fail(404, 'Business not found.');
      fresh(site!, input.updatedAt);
      if (input.confirmDomain !== site!.domain) fail(400, 'Type the exact business domain to confirm permanent deletion.');
      const [reviews] = await tx.select({ count: count() }).from(s.directoryReviews).where(eq(s.directoryReviews.businessId, businessId));
      await tx.insert(s.directoryAudit).values({
        actorId: actor.id, action: 'business.deleted', targetId: businessId,
        note: site!.domain + ' (' + site!.name + '), ' + reviews!.count + ' reviews and related claims, teams, reports and monitoring history permanently deleted: ' + input.reason,
      });
      await tx.delete(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, businessId));
    });
    return c.json({ success: true });
  });
}
