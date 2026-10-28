import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from 'hono/bun';
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';
import { auth } from '../infrastructure/auth/auth';
import { isPublicAddress, normalizeDomain, validateTarget } from './network';
import { assessRisk, networkFingerprint, similarity, textFingerprint } from './fraud';
import { checkClaim } from './claims';
import { mailConfigured, publicBaseUrl } from './mail';
import { monitorSummary } from './monitoring';
import { renderWidget, embedLoader } from './widgets';
import { registerDonationRoutes } from '../donations/router';
import { businessCategories, registerAdministrationRoutes, requireOpenReviews } from './administration';
import { profileIdentity, registerAccountRoutes } from './account';
import { registerResolutionRoutes } from './resolutions';
import { avatarUrl, publicAuthor, publicAvatar } from './identity';
import { AVATAR_UPLOAD_LIMIT } from './avatars';
import { registerUserAdministration } from './users';

export const directoryRouter = new Hono();
type User = typeof s.users.$inferSelect;
const categories = businessCategories;
const idSchema = z.string().uuid();
const reviewSchema = z.object({
  title: z.string().trim().min(3).max(160), content: z.string().trim().min(20).max(5000),
  rating: z.number().int().min(1).max(5), _honey: z.string().max(200).optional(),
  anonymous: z.boolean().optional(),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string): never => { throw new HTTPException(status, { message }); };
function id(value: string) { const result = idSchema.safeParse(value); if (!result.success) fail(400, 'Invalid identifier.'); return result.data!; }
async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) fail(400, result.error.issues[0]?.message ?? 'Invalid request.');
  return result.data!;
}

directoryRouter.use('*', (c, next) => bodyLimit({
  maxSize: c.req.method === 'POST' && c.req.path.endsWith('/account/avatar') ? AVATAR_UPLOAD_LIMIT : 32768,
  onError: (context) => context.json({ error: 'Request body is too large. Pictures must be smaller than 2 MB.' }, 413),
})(c, next));
directoryRouter.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    const allowed = [publicBaseUrl(), ...(process.env.AUTH_TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim())];
    if (origin && !allowed.includes(origin)) fail(403, 'This request came from an untrusted origin.');
  }
  await next();
});
directoryRouter.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error.name === 'BodyLimitError') return c.json({ error: 'Request body is too large.' }, 413);
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    const detail = cause as { code?: string; errno?: string | number; cause?: unknown };
    if (detail.code === '23505' || String(detail.errno) === '23505') {
      return c.json({ error: 'This record already exists. Refresh and try again.' }, 409);
    }
    cause = detail.cause;
  }
  console.error('[Directory]', error.name);
  return c.json({ error: 'The operation could not be completed. Please try again.' }, 500);
});

async function user(c: Context, verified = false): Promise<User> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) fail(401, 'Sign in to continue.');
  const [found] = await db.select().from(s.users).where(eq(s.users.id, session!.user.id));
  if (!found) fail(401, 'Account no longer exists.');
  if (found!.suspendedAt) fail(403, 'This account is suspended. Contact platform support.');
  if (verified && !found!.emailVerified && !found!.isSystemAdmin) fail(403, 'Verify your email before claiming a business or posting a review.');
  return found!;
}
async function staff(c: Context) { const actor = await user(c); if (!actor.isSystemAdmin) fail(403, 'Platform moderation is restricted to administrators.'); return actor; }
async function businessById(value: string) {
  const [site] = await db.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, id(value)));
  if (!site) fail(404, 'Business not found.');
  return site!;
}
async function businessByDomain(value: string) {
  let domain: string;
  try { domain = normalizeDomain(value); } catch { return fail(400, 'Invalid public domain.'); }
  const [site] = await db.select().from(s.directoryBusinesses).where(and(eq(s.directoryBusinesses.domain, domain), eq(s.directoryBusinesses.listed, true)));
  if (!site) fail(404, 'Business not found.');
  return site!;
}
async function access(actor: User, businessId: string, ownerOnly = false) {
  const site = await businessById(businessId);
  if (actor.isSystemAdmin || site.ownerId === actor.id) return site;
  const [member] = await db.select().from(s.directoryMembers).where(and(eq(s.directoryMembers.businessId, site.id), eq(s.directoryMembers.userId, actor.id)));
  if (!member || ownerOnly) fail(403, 'You do not have permission to manage this business.');
  return site;
}
async function lockedAccess(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actor: User, businessId: string, ownerOnly = false) {
  const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, businessId)).for('update');
  if (!site) fail(404, 'Business not found.');
  if (actor.isSystemAdmin || site!.ownerId === actor.id) return site!;
  const [member] = await tx.select().from(s.directoryMembers).where(and(eq(s.directoryMembers.businessId, businessId), eq(s.directoryMembers.userId, actor.id)));
  if (!member || ownerOnly) fail(403, 'You do not have permission to manage this business.');
  return site!;
}
async function rate(actorId: string, scope: string, max: number) {
  const [row] = await db.insert(s.rateLimits).values({ key: 'directory:' + scope + ':' + actorId, count: 1, resetAt: new Date(Date.now() + 3600000) })
    .onConflictDoUpdate({ target: s.rateLimits.key, set: {
      count: sql.raw('CASE WHEN "rate_limits"."reset_at" < now() THEN 1 ELSE "rate_limits"."count" + 1 END'),
      resetAt: sql.raw('CASE WHEN "rate_limits"."reset_at" < now() THEN now() + interval \'1 hour\' ELSE "rate_limits"."reset_at" END'),
    } }).returning();
  if (row!.count > max) fail(429, 'Hourly limit reached. Please try again later.');
}
registerDonationRoutes(directoryRouter, { user, staff, rate, body });
registerAdministrationRoutes(directoryRouter, { staff, body, publicBusiness });
registerAccountRoutes(directoryRouter, { user, staff, rate, body });
registerResolutionRoutes(directoryRouter, { user, staff, rate, body });
registerUserAdministration(directoryRouter, { user, staff, rate, body });
function publicBusiness(site: typeof s.directoryBusinesses.$inferSelect) {
  return { id: site.id, domain: site.domain, name: site.name, description: site.description, category: site.category, claimed: !!site.ownerId, createdAt: site.createdAt, permanentlyClosed: site.permanentlyClosed, reviewsClosed: site.reviewsClosed, updatedAt: site.updatedAt };
}
export async function businessScore(businessId: string) {
  const rows = await db.select({ rating: s.directoryReviews.rating, count: count() }).from(s.directoryReviews)
    .where(and(eq(s.directoryReviews.businessId, businessId), eq(s.directoryReviews.status, 'published'))).groupBy(s.directoryReviews.rating);
  const total = rows.reduce((n, r) => n + Number(r.count), 0);
  const sum = rows.reduce((n, r) => n + r.rating * Number(r.count), 0);
  return { count: total, average: total ? Math.round(sum / total * 10) / 10 : null, distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: Number(rows.find((r) => r.rating === rating)?.count ?? 0) })) };
}
async function publicReviews(businessId: string, page = 1) {
  return db.select({
    id: s.directoryReviews.id, title: s.directoryReviews.title, content: s.directoryReviews.content, rating: s.directoryReviews.rating,
    author: publicAuthor, avatar: publicAvatar, anonymous: s.directoryReviews.anonymous, emailVerified: s.users.emailVerified, createdAt: s.directoryReviews.createdAt,
    reply: s.directoryReviews.reply, replyAt: s.directoryReviews.replyAt,
    resolutionAccepted: sql<boolean>`${s.directoryReviews.resolutionStatus} = 'accepted'`,
    resolutionNote: sql<string | null>`case when ${s.directoryReviews.resolutionStatus} = 'accepted' then ${s.directoryReviews.resolutionNote} else null end`,
  }).from(s.directoryReviews).innerJoin(s.users, eq(s.directoryReviews.reviewerId, s.users.id))
    .leftJoin(s.userProfiles, eq(s.userProfiles.userId, s.users.id))
    .where(and(eq(s.directoryReviews.businessId, businessId), eq(s.directoryReviews.status, 'published')))
    .orderBy(desc(s.directoryReviews.createdAt)).limit(20).offset((page - 1) * 20);
}
async function monitoring(businessId: string) {
  const [monitor] = await db.select().from(s.directoryMonitors).where(eq(s.directoryMonitors.businessId, businessId));
  if (!monitor) return null;
  const checks = await db.select().from(s.directoryChecks).where(and(eq(s.directoryChecks.monitorId, monitor.id), gte(s.directoryChecks.checkedAt, new Date(Date.now() - 31 * 86400000))));
  const incidents = await db.select().from(s.directoryIncidents).where(eq(s.directoryIncidents.monitorId, monitor.id)).orderBy(desc(s.directoryIncidents.startedAt));
  return monitorSummary(monitor, checks, incidents);
}

directoryRouter.get('/config', (c) => c.json({ emailConfigured: mailConfigured(), categories }));
directoryRouter.get('/businesses', async (c) => {
  const q = (c.req.query('q') ?? '').slice(0, 120).replace(/[%_\\]/g, '\\$&');
  const category = c.req.query('category');
  const page = Math.min(100, Math.max(1, Number(c.req.query('page')) || 1));
  const filters = and(eq(s.directoryBusinesses.listed, true), q ? or(ilike(s.directoryBusinesses.name, '%' + q + '%'), ilike(s.directoryBusinesses.domain, '%' + q + '%')) : undefined, category ? eq(s.directoryBusinesses.category, category) : undefined);
  const sites = await db.select().from(s.directoryBusinesses).where(filters).orderBy(desc(s.directoryBusinesses.createdAt)).limit(24).offset((page - 1) * 24);
  const [total] = await db.select({ count: count() }).from(s.directoryBusinesses).where(filters);
  return c.json({ businesses: await Promise.all(sites.map(async (site) => ({ ...publicBusiness(site), score: await businessScore(site.id) }))), total: Number(total!.count), page });
});
directoryRouter.post('/businesses', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'listing', 10);
  const input = await body(c, z.object({ domain: z.string().max(500), name: z.string().trim().min(2).max(120), category: z.enum(categories).default('Other') }));
  let domain: string;
  try { domain = normalizeDomain(input.domain); } catch (error) { return fail(400, (error as Error).message); }
  const [site] = await db.insert(s.directoryBusinesses).values({ domain, name: input.name, category: input.category }).onConflictDoNothing().returning();
  const result = site ?? (await db.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.domain, domain)))[0]!;
  if (!result.listed) fail(403, 'This listing is unavailable. Contact platform support.');
  return c.json(publicBusiness(result), site ? 201 : 200);
});
directoryRouter.get('/businesses/:domain', async (c) => {
  c.header('Cache-Control', 'no-store');
  const site = await businessByDomain(c.req.param('domain'));
  const page = Math.min(100, Math.max(1, Number(c.req.query('page')) || 1));
  return c.json({ business: publicBusiness(site), score: await businessScore(site.id), reviews: await publicReviews(site.id, page), monitoring: await monitoring(site.id), page });
});
directoryRouter.get('/me', async (c) => {
  const actor = await user(c);
  const memberships = await db.select({ business: s.directoryBusinesses }).from(s.directoryMembers).innerJoin(s.directoryBusinesses, eq(s.directoryBusinesses.id, s.directoryMembers.businessId)).where(eq(s.directoryMembers.userId, actor.id));
  const owned = await db.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.ownerId, actor.id));
  const sites = [...new Map([...owned, ...memberships.map((m) => m.business)].map((b) => [b.id, b])).values()];
  const claims = await db.select({ claim: s.directoryClaims, domain: s.directoryBusinesses.domain }).from(s.directoryClaims).innerJoin(s.directoryBusinesses, eq(s.directoryBusinesses.id, s.directoryClaims.businessId)).where(eq(s.directoryClaims.userId, actor.id)).orderBy(desc(s.directoryClaims.createdAt)).limit(20);
  const reviews = await db.select({
    id: s.directoryReviews.id, domain: s.directoryBusinesses.domain, title: s.directoryReviews.title, content: s.directoryReviews.content,
    rating: s.directoryReviews.rating, status: s.directoryReviews.status, moderationReason: s.directoryReviews.moderationReason, updatedAt: s.directoryReviews.updatedAt,
    reviewsClosed: s.directoryBusinesses.reviewsClosed, listed: s.directoryBusinesses.listed,
    anonymous: s.directoryReviews.anonymous, resolutionStatus: s.directoryReviews.resolutionStatus, resolutionNote: s.directoryReviews.resolutionNote,
    resolutionVersion: s.directoryReviews.resolutionVersion, resolutionRequestedAt: s.directoryReviews.resolutionRequestedAt, resolutionRespondedAt: s.directoryReviews.resolutionRespondedAt,
  }).from(s.directoryReviews).innerJoin(s.directoryBusinesses, eq(s.directoryReviews.businessId, s.directoryBusinesses.id)).where(eq(s.directoryReviews.reviewerId, actor.id)).orderBy(desc(s.directoryReviews.createdAt)).limit(100);
  const alerts = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, actor.id), ilike(s.notifications.type, 'directory.%'))).orderBy(desc(s.notifications.createdAt)).limit(30);
  return c.json({ user: { id: actor.id, name: actor.name, email: actor.email, emailVerified: actor.emailVerified, isSystemAdmin: actor.isSystemAdmin, image: avatarUrl(actor.image) }, identity: await profileIdentity(actor), businesses: sites.map((b) => ({ ...publicBusiness(b), isOwner: b.ownerId === actor.id })), claims, reviews, alerts, emailConfigured: mailConfigured() });
});
directoryRouter.post('/verification-email', async (c) => {
  const actor = await user(c); await rate(actor.id, 'verification', 5);
  if (!mailConfigured()) fail(503, 'Email delivery is not configured yet. Please contact the platform administrator.');
  await auth.api.sendVerificationEmail({ body: { email: actor.email, callbackURL: publicBaseUrl() + '/dashboard' }, headers: c.req.raw.headers });
  return c.json({ success: true });
});
directoryRouter.post('/businesses/:id/claims', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'claim', 10);
  const site = await businessById(c.req.param('id'));
  if (!site.listed || site.permanentlyClosed) fail(403, 'This listing is unavailable for new ownership claims. Contact platform support.');
  if (site.ownerId) fail(409, 'This business is already claimed. Ask its owner for an invitation or contact platform support.');
  const input = await body(c, z.object({ method: z.enum(['dns', 'file']) }));
  const claim = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, site.id)).for('share');
    if (!current) fail(404, 'Business not found.');
    if (!current!.listed || current!.permanentlyClosed) fail(403, 'This listing is unavailable for new ownership claims. Contact platform support.');
    if (current!.ownerId) fail(409, 'This business is already claimed. Contact platform support.');
    const [created] = await tx.insert(s.directoryClaims).values({
      businessId: site.id, userId: actor.id, method: input.method, token: 'reviewskits-verification=' + randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    }).returning();
    return created!;
  });
  return c.json({ claim: claim!, domain: site.domain }, 201);
});
directoryRouter.post('/claims/:id/check', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'claim-check', 30);
  const [claim] = await db.select().from(s.directoryClaims).where(and(eq(s.directoryClaims.id, id(c.req.param('id'))), eq(s.directoryClaims.userId, actor.id)));
  if (!claim) fail(404, 'Claim not found.');
  if (claim!.attempts && claim!.nextCheckAt.getTime() - Date.now() > 240000) fail(429, 'Wait at least one minute between verification attempts.');
  await checkClaim(claim!);
  return c.json({ claim: (await db.select().from(s.directoryClaims).where(eq(s.directoryClaims.id, claim!.id)))[0] });
});
directoryRouter.get('/managed/:id', async (c) => {
  const actor = await user(c); const site = await access(actor, c.req.param('id'));
  const members = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.directoryMembers).innerJoin(s.users, eq(s.directoryMembers.userId, s.users.id)).where(eq(s.directoryMembers.businessId, site.id));
  const [monitor] = await db.select().from(s.directoryMonitors).where(eq(s.directoryMonitors.businessId, site.id));
  const publicRows = await publicReviews(site.id);
  const ownResolutions = publicRows.length ? await db.select({ id: s.directoryReviews.id, resolutionStatus: s.directoryReviews.resolutionStatus, resolutionVersion: s.directoryReviews.resolutionVersion,
    resolutionNote: s.directoryReviews.resolutionNote, resolutionRespondedAt: s.directoryReviews.resolutionRespondedAt }).from(s.directoryReviews).where(inArray(s.directoryReviews.id, publicRows.map((row) => row.id))) : [];
  return c.json({ business: { ...publicBusiness(site), isOwner: actor.isSystemAdmin || site.ownerId === actor.id }, canRequestResolution: site.ownerId === actor.id || members.some((member) => member.id === actor.id), members, monitor: monitor ?? null, monitoring: await monitoring(site.id), score: await businessScore(site.id),
    reviews: publicRows.map((row) => ({ ...row, ...ownResolutions.find((resolution) => resolution.id === row.id) })) });
});
directoryRouter.patch('/managed/:id', async (c) => {
  const actor = await user(c, true); const site = await access(actor, c.req.param('id'));
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(2000), category: z.enum(categories) }));
  await db.transaction(async (tx) => {
    await lockedAccess(tx, actor, site.id);
    await tx.update(s.directoryBusinesses).set({ ...input, updatedAt: sql`greatest(now(), ${s.directoryBusinesses.updatedAt} + interval '1 millisecond')` }).where(eq(s.directoryBusinesses.id, site.id));
  });
  return c.json({ success: true });
});
directoryRouter.post('/managed/:id/invites', async (c) => {
  const actor = await user(c, true); const site = await access(actor, c.req.param('id'), true); await rate(actor.id, 'invite', 20);
  const input = await body(c, z.object({ email: z.string().email().max(254) }));
  const token = randomBytes(32).toString('hex');
  const link = publicBaseUrl() + '/dashboard?invite=' + token;
  await db.transaction(async (tx) => {
    await lockedAccess(tx, actor, site.id, true);
    await tx.insert(s.directoryInvites).values({ businessId: site.id, email: input.email.toLowerCase(), tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) });
    if (mailConfigured()) await tx.insert(s.directoryMail).values({ to: input.email, subject: 'Invitation to manage ' + site.domain, body: 'Sign in with this email address, then accept your invitation: ' + link });
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'member.invited', targetId: site.id, note: 'Team invitation created' });
  });
  return c.json({ link, emailQueued: mailConfigured() }, 201);
});
directoryRouter.post('/invites/accept', async (c) => {
  const actor = await user(c, true); const input = await body(c, z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }));
  await db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(s.directoryInvites).where(eq(s.directoryInvites.tokenHash, hash(input.token)));
    if (!candidate) fail(403, 'Invitation expired, already used, or belongs to another email address.');
    // Use the same parent-first lock order as staff transfers and deletion.
    await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, candidate!.businessId)).for('share');
    const [invite] = await tx.select().from(s.directoryInvites).where(eq(s.directoryInvites.tokenHash, hash(input.token))).for('update');
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date() || invite.email !== actor.email.toLowerCase()) fail(403, 'Invitation expired, already used, or belongs to another email address.');
    await tx.insert(s.directoryMembers).values({ businessId: invite!.businessId, userId: actor.id }).onConflictDoNothing();
    await tx.update(s.directoryInvites).set({ acceptedAt: new Date() }).where(eq(s.directoryInvites.id, invite!.id));
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'member.joined', targetId: invite!.businessId, note: 'Email-bound invitation accepted' });
  });
  return c.json({ success: true });
});
directoryRouter.delete('/managed/:id/members/:userId', async (c) => {
  const actor = await user(c, true); const site = await access(actor, c.req.param('id'), true);
  const target = id(c.req.param('userId'));
  if (site.ownerId === target) fail(400, 'Ownership transfers require platform support.');
  await db.transaction(async (tx) => {
    const current = await lockedAccess(tx, actor, site.id, true);
    if (current.ownerId === target) fail(400, 'Ownership transfers require platform support.');
    await tx.delete(s.directoryMembers).where(and(eq(s.directoryMembers.businessId, site.id), eq(s.directoryMembers.userId, target)));
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'member.removed', targetId: site.id, note: 'Member removed: ' + target });
  });
  return c.json({ success: true });
});

async function reviewRisk(c: Context, actor: User, siteId: string, content: string, exclude?: string) {
  let remote: string | undefined;
  try { remote = getConnInfo(c).remote.address; } catch { /* In-process tests have no socket. */ }
  // Only explicitly trusted reverse proxies may supply forwarded addresses.
  if (remote && (process.env.TRUSTED_PROXY_IPS ?? '').split(',').includes(remote)) remote = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? remote;
  // A shared private reverse-proxy address must not link all of its customers.
  if (remote && !isPublicAddress(remote)) remote = undefined;
  const networkKey = networkFingerprint(remote);
  const recent = await db.select().from(s.directoryReviews).orderBy(desc(s.directoryReviews.createdAt)).limit(500);
  const others = recent.filter((r) => r.id !== exclude);
  const hourAgo = Date.now() - 3600000;
  const [member] = await db.select().from(s.directoryMembers).where(and(eq(s.directoryMembers.userId, actor.id), eq(s.directoryMembers.businessId, siteId)));
  const site = await businessById(siteId);
  const fingerprint = textFingerprint(content);
  const risk = assessRisk({
    email: actor.email, accountAgeMs: Date.now() - actor.createdAt.getTime(), isBusinessMember: !!member || site.ownerId === actor.id,
    duplicate: others.some((r) => r.reviewerId !== actor.id && r.fingerprint === fingerprint),
    similar: others.some((r) => r.reviewerId !== actor.id && similarity(content, r.content) >= 0.85),
    recentAccountReviews: others.filter((r) => r.reviewerId === actor.id && r.createdAt.getTime() > hourAgo).length,
    recentNetworkAccounts: new Set(others.filter((r) => networkKey && r.networkKey === networkKey && r.createdAt.getTime() > hourAgo).map((r) => r.reviewerId)).size,
  });
  return { riskScore: risk.score, riskReasons: risk.reasons, fingerprint, networkKey, status: risk.score >= 60 ? 'quarantined' as const : 'pending' as const };
}
directoryRouter.post('/businesses/:id/reviews', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'review', 10);
  const site = await businessById(c.req.param('id'));
  requireOpenReviews(site);
  const input = await body(c, reviewSchema);
  if (input._honey) return c.json({ success: true, status: 'pending' }, 201);
  const signals = await reviewRisk(c, actor, site.id, input.content);
  const review = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, site.id)).for('share');
    if (!current) fail(404, 'Business not found.');
    requireOpenReviews(current!);
    const identity = await profileIdentity(actor);
    const [saved] = await tx.insert(s.directoryReviews).values({ businessId: site.id, reviewerId: actor.id, title: input.title, content: input.content, rating: input.rating, anonymous: input.anonymous ?? identity.defaultAnonymousReviews, ...signals }).returning();
    return saved!;
  });
  return c.json({ id: review!.id, status: review!.status }, 201);
});
directoryRouter.patch('/reviews/:id', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'review-edit', 10);
  const reviewId = id(c.req.param('id'));
  const [review] = await db.select().from(s.directoryReviews).where(and(eq(s.directoryReviews.id, reviewId), eq(s.directoryReviews.reviewerId, actor.id)));
  if (!review) fail(404, 'Your review was not found.');
  requireOpenReviews(await businessById(review!.businessId));
  const input = await body(c, reviewSchema);
  const signals = await reviewRisk(c, actor, review!.businessId, input.content, reviewId);
  await db.transaction(async (tx) => {
    const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, review!.businessId)).for('share');
    if (!site) fail(404, 'Business not found.');
    requireOpenReviews(site!);
    await tx.update(s.directoryReviews).set({ title: input.title, content: input.content, rating: input.rating, ...(input.anonymous === undefined ? {} : { anonymous: input.anonymous }), ...signals, moderationReason: null, updatedAt: new Date() }).where(eq(s.directoryReviews.id, reviewId));
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.edited', targetId: reviewId, note: 'Edited review returned to platform moderation' });
  });
  return c.json({ success: true, status: signals.status });
});
directoryRouter.post('/reviews/:id/reply', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'reply', 30);
  const [review] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, id(c.req.param('id'))));
  if (!review || review.status !== 'published') fail(404, 'Published review not found.');
  await access(actor, review!.businessId);
  const input = await body(c, z.object({ reply: z.string().trim().min(2).max(3000) }));
  await db.transaction(async (tx) => {
    await lockedAccess(tx, actor, review!.businessId);
    await tx.update(s.directoryReviews).set({ reply: input.reply, replyBy: actor.id, replyAt: new Date() }).where(eq(s.directoryReviews.id, review!.id));
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.replied', targetId: review!.id, note: 'Business response updated' });
  });
  return c.json({ success: true });
});
directoryRouter.post('/reviews/:id/reports', async (c) => {
  const actor = await user(c, true); await rate(actor.id, 'report', 20);
  const input = await body(c, z.object({ kind: z.enum(['report', 'appeal']).default('report'), reason: z.string().trim().min(10).max(2000) }));
  const [review] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, id(c.req.param('id'))));
  if (!review || (review.status !== 'published' && review.reviewerId !== actor.id && !actor.isSystemAdmin)) fail(404, 'Review not found.');
  if (input.kind === 'appeal' && review!.reviewerId !== actor.id) fail(403, 'Only the review author can appeal.');
  await db.insert(s.directoryReports).values({ reviewId: review!.id, reporterId: actor.id, ...input });
  return c.json({ success: true }, 201);
});
directoryRouter.put('/managed/:id/monitor', async (c) => {
  const actor = await user(c, true); const site = await access(actor, c.req.param('id'), true);
  if (!site.ownerId) fail(403, 'Verify domain ownership before enabling monitoring.');
  const input = await body(c, z.object({ enabled: z.boolean(), url: z.string().max(2000), expectedText: z.string().max(200).default('') }));
  try { validateTarget(input.url, site.domain); } catch (error) { return fail(400, (error as Error).message); }
  await db.transaction(async (tx) => {
    const currentSite = await lockedAccess(tx, actor, site.id, true);
    if (!currentSite.ownerId) fail(403, 'Verify domain ownership before enabling monitoring.');
    if (input.enabled && (!currentSite.listed || currentSite.permanentlyClosed)) fail(403, 'Monitoring cannot run for hidden or permanently closed businesses.');
    // Serializes quota checks across simultaneous requests.
    await tx.execute(sql.raw("SELECT pg_advisory_xact_lock(972401)"));
    const [existing] = await tx.select().from(s.directoryMonitors).where(eq(s.directoryMonitors.businessId, site.id)).for('update');
    const active = await tx.select({ count: count() }).from(s.directoryMonitors).where(eq(s.directoryMonitors.enabled, true));
    if (input.enabled && !existing?.enabled && Number(active[0]!.count) >= (Number(process.env.MAX_ACTIVE_MONITORS) || 100)) fail(409, 'The platform monitoring limit has been reached.');
    if (existing?.leaseUntil && existing.leaseUntil > new Date()) fail(409, 'A check is in progress. Try again in a moment.');
    const now = new Date();
    if (existing) {
      await tx.update(s.directoryMonitors).set({ ...input, startedAt: existing.startedAt ?? (input.enabled ? now : null), nextCheckAt: now, lastResult: 'unknown', lastCheckAt: input.enabled ? null : existing.lastCheckAt, failureStreak: 0, recoveryStreak: 0, firstFailureAt: null }).where(eq(s.directoryMonitors.id, existing.id));
      await tx.update(s.directoryIncidents).set({ endedAt: now, reason: sql.join([s.directoryIncidents.reason, sql.raw(" || ' [Monitoring configuration changed; incident ended administratively]'")], sql.raw('')) }).where(and(eq(s.directoryIncidents.monitorId, existing.id), isNull(s.directoryIncidents.endedAt)));
    } else await tx.insert(s.directoryMonitors).values({ businessId: site.id, ...input, startedAt: input.enabled ? now : null });
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'monitor.configured', targetId: site.id, note: input.enabled ? 'Monitoring enabled; five-minute interval' : 'Monitoring paused; any open incident ended administratively' });
  });
  return c.json({ success: true });
});

directoryRouter.get('/moderation', async (c) => {
  await staff(c);
  c.header('Cache-Control', 'no-store');
  const status = c.req.query('status') ?? 'pending';
  const page = Math.min(100, Math.max(1, Number(c.req.query('page')) || 1));
  const reviewId = c.req.query('reviewId');
  if (reviewId) id(reviewId);
  if (!['pending', 'quarantined', 'published', 'rejected', 'all'].includes(status)) fail(400, 'Invalid moderation status.');
  const reviews = await db.select({ review: s.directoryReviews, business: { domain: s.directoryBusinesses.domain, name: s.directoryBusinesses.name }, reviewer: { id: s.users.id, name: s.users.name, email: s.users.email, emailVerified: s.users.emailVerified, createdAt: s.users.createdAt } })
    .from(s.directoryReviews).innerJoin(s.directoryBusinesses, eq(s.directoryBusinesses.id, s.directoryReviews.businessId)).innerJoin(s.users, eq(s.users.id, s.directoryReviews.reviewerId))
    .where(reviewId ? eq(s.directoryReviews.id, reviewId) : status === 'all' ? undefined : eq(s.directoryReviews.status, status as 'pending')).orderBy(desc(s.directoryReviews.createdAt)).limit(100).offset(reviewId ? 0 : (page - 1) * 100);
  const counts = await db.select({ status: s.directoryReviews.status, count: count() }).from(s.directoryReviews).groupBy(s.directoryReviews.status);
  const reports = await db.select({ report: s.directoryReports, title: s.directoryReviews.title, domain: s.directoryBusinesses.domain }).from(s.directoryReports)
    .innerJoin(s.directoryReviews, eq(s.directoryReviews.id, s.directoryReports.reviewId)).innerJoin(s.directoryBusinesses, eq(s.directoryBusinesses.id, s.directoryReviews.businessId))
    .where(isNull(s.directoryReports.resolvedAt)).orderBy(desc(s.directoryReports.createdAt)).limit(100);
  const audit = await db.select().from(s.directoryAudit).orderBy(desc(s.directoryAudit.createdAt)).limit(50);
  const workers = await db.select().from(s.directoryWorkers);
  return c.json({ reviews: reviews.map((r) => ({ ...r, review: { ...r.review, networkKey: undefined, fingerprint: undefined } })), counts, reports, audit, workers, workerHealthy: workers.some((w) => Date.now() - w.lastSeenAt.getTime() < 120000), emailConfigured: mailConfigured() });
});
directoryRouter.get('/moderation/reviews/:id/evidence', async (c) => {
  await staff(c);
  const [review] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, id(c.req.param('id'))));
  if (!review) fail(404, 'Review not found.');
  const matches = await db.select({ id: s.directoryReviews.id, reviewerId: s.directoryReviews.reviewerId, title: s.directoryReviews.title, status: s.directoryReviews.status, createdAt: s.directoryReviews.createdAt, domain: s.directoryBusinesses.domain, author: s.users.name })
    .from(s.directoryReviews).innerJoin(s.directoryBusinesses, eq(s.directoryBusinesses.id, s.directoryReviews.businessId)).innerJoin(s.users, eq(s.users.id, s.directoryReviews.reviewerId))
    .where(or(eq(s.directoryReviews.fingerprint, review!.fingerprint), review!.networkKey ? eq(s.directoryReviews.networkKey, review!.networkKey) : undefined, eq(s.directoryReviews.reviewerId, review!.reviewerId)))
    .orderBy(desc(s.directoryReviews.createdAt)).limit(50);
  return c.json({ reasons: review!.riskReasons, score: review!.riskScore, possibleConnections: matches.filter((r) => r.id !== review!.id), notice: 'Shared networks and similar text are investigation leads, not proof of a shared identity.' });
});
directoryRouter.post('/moderation/reviews/:id', async (c) => {
  const actor = await staff(c);
  const input = await body(c, z.object({ status: z.enum(['published', 'rejected', 'quarantined', 'pending']), reason: z.string().trim().min(5).max(2000), updatedAt: z.string().datetime() }));
  const reviewId = id(c.req.param('id'));
  await db.transaction(async (tx) => {
    const [review] = await tx.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, reviewId)).for('update');
    if (!review) fail(404, 'Review not found.');
    if (review!.updatedAt.toISOString() !== input.updatedAt) fail(409, 'This review changed. Refresh before making a decision.');
    await tx.update(s.directoryReviews).set({ status: input.status, moderationReason: input.reason, updatedAt: new Date() }).where(eq(s.directoryReviews.id, reviewId));
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.' + input.status, targetId: reviewId, note: input.reason });
    await tx.insert(s.notifications).values({ userId: review!.reviewerId, type: 'directory.moderated', title: 'Review decision: ' + input.status, body: input.reason });
  });
  return c.json({ success: true });
});
directoryRouter.post('/moderation/reports/:id', async (c) => {
  const actor = await staff(c); const reportId = id(c.req.param('id'));
  const input = await body(c, z.object({ resolution: z.string().trim().min(5).max(2000) }));
  await db.transaction(async (tx) => {
    const [report] = await tx.update(s.directoryReports).set({ resolution: input.resolution, resolvedAt: new Date() }).where(and(eq(s.directoryReports.id, reportId), isNull(s.directoryReports.resolvedAt))).returning();
    if (!report) fail(404, 'Open report not found.');
    await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'report.resolved', targetId: reportId, note: input.resolution });
    await tx.insert(s.notifications).values({ userId: report!.reporterId, type: 'directory.report-resolved', title: 'Your report or appeal was reviewed', body: input.resolution });
  });
  return c.json({ success: true });
});
directoryRouter.get('/scores/:domain', async (c) => {
  const site = await businessByDomain(c.req.param('domain'));
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ business: publicBusiness(site), score: await businessScore(site.id), url: publicBaseUrl() + '/business/' + site.domain });
});
directoryRouter.get('/embed.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(embedLoader);
});
directoryRouter.get('/widgets/:domain', async (c) => {
  const site = await businessByDomain(c.req.param('domain'));
  const mode = c.req.query('mode') === 'highlights' ? 'highlights' : c.req.query('mode') === 'recent' ? 'recent' : 'badge';
  const minRating = Math.min(5, Math.max(1, Number(c.req.query('minRating')) || 4));
  const selected = (c.req.query('ids') ?? '').split(',').filter((v) => idSchema.safeParse(v).success).slice(0, 6);
  const reviews = mode === 'badge' ? [] : await db.select({ title: s.directoryReviews.title, content: s.directoryReviews.content, rating: s.directoryReviews.rating, author: publicAuthor,
    resolutionAccepted: sql<boolean>`${s.directoryReviews.resolutionStatus} = 'accepted'` })
    .from(s.directoryReviews).innerJoin(s.users, eq(s.users.id, s.directoryReviews.reviewerId))
    .leftJoin(s.userProfiles, eq(s.userProfiles.userId, s.users.id))
    .where(and(eq(s.directoryReviews.businessId, site.id), eq(s.directoryReviews.status, 'published'),
      mode === 'highlights' && !selected.length ? gte(s.directoryReviews.rating, minRating) : undefined,
      mode === 'highlights' && selected.length ? inArray(s.directoryReviews.id, selected) : undefined))
    .orderBy(desc(s.directoryReviews.createdAt)).limit(6);
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.html(renderWidget(publicBusiness(site), await businessScore(site.id), reviews, mode, c.req.query('theme') === 'dark'));
});
