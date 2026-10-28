import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';
import { nextBusinessVersion } from './administration';
import { avatarUrl, profilePseudonym } from './identity';
import { normalizeAvatar } from './avatars';

type Actor = typeof s.users.$inferSelect;
export type AccountHelpers = {
  user: (c: Context, verified?: boolean) => Promise<Actor>;
  staff: (c: Context) => Promise<Actor>;
  rate: (actorId: string, scope: string, max: number) => Promise<void>;
  body: <T extends z.ZodType>(c: Context, schema: T) => Promise<z.infer<T>>;
};
export function accountFail(status: 400 | 403 | 404 | 409, message: string): never { throw new HTTPException(status, { message }); }
export function accountId(value: string) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) accountFail(400, 'Invalid account or review identifier.');
  return parsed.data!;
}
export async function profileIdentity(actor: Actor) {
  const [row] = await db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, actor.id));
  return { mode: row?.nameMode ?? 'account' as const, pseudonym: row?.pseudonym ?? null, defaultAnonymousReviews: row?.defaultAnonymousReviews ?? false,
    publicName: row?.nameMode === 'pseudonym' ? row.pseudonym! : actor.name };
}
export function registerAccountRoutes(router: Hono, { user, rate, body }: AccountHelpers) {
  router.use('/account/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  router.get('/account', async (c) => {
    const actor = await user(c);
    c.header('Cache-Control', 'no-store');
    return c.json({
      user: { id: actor.id, name: actor.name, email: actor.email, emailVerified: actor.emailVerified, isSystemAdmin: actor.isSystemAdmin, image: avatarUrl(actor.image), updatedAt: actor.updatedAt.toISOString() },
      identity: await profileIdentity(actor), notifications: actor.notificationPrefs ?? { newReview: true, weeklyReport: true },
    });
  });
  router.patch('/account', async (c) => {
    const actor = await user(c); await rate(actor.id, 'profile', 30);
    const input = await body(c, z.object({
      name: z.string().trim().min(2).max(80), mode: z.enum(['account', 'pseudonym']), pseudonym: z.string().max(80).nullable(),
      defaultAnonymousReviews: z.boolean(), notifications: z.object({ newReview: z.boolean(), weeklyReport: z.boolean() }),
      updatedAt: z.string().datetime(),
    }).strict());
    let pseudonym: string | null = null;
    try { if (input.pseudonym?.trim()) pseudonym = profilePseudonym(input.pseudonym); }
    catch (error) { accountFail(400, (error as Error).message); }
    if (input.mode === 'pseudonym' && !pseudonym) accountFail(400, 'Enter a pseudonym before using it publicly.');
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(s.users).where(eq(s.users.id, actor.id)).for('update');
      if (!current || current.suspendedAt) accountFail(403, 'This account is unavailable.');
      if (current.updatedAt.toISOString() !== input.updatedAt) accountFail(409, 'Your account changed. Reload settings before saving.');
      await tx.update(s.users).set({ name: input.name, notificationPrefs: input.notifications, updatedAt: nextBusinessVersion(current.updatedAt) }).where(eq(s.users.id, actor.id));
      await tx.insert(s.userProfiles).values({ userId: actor.id, nameMode: input.mode, pseudonym, defaultAnonymousReviews: input.defaultAnonymousReviews })
        .onConflictDoUpdate({ target: s.userProfiles.userId, set: { nameMode: input.mode, pseudonym, defaultAnonymousReviews: input.defaultAnonymousReviews } });
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.profile-updated', targetId: actor.id, note: 'Account profile, public identity and privacy preferences updated.' });
    });
    return c.json({ success: true });
  });
  router.post('/account/avatar', async (c) => {
    const actor = await user(c); await rate(actor.id, 'avatar', 10);
    if (!['image/png', 'image/jpeg'].includes(c.req.header('Content-Type')?.split(';')[0] ?? '')) accountFail(400, 'Choose a PNG or JPEG picture.');
    const bytes = Buffer.from(await c.req.arrayBuffer());
    let png: string;
    try { png = await normalizeAvatar(bytes); }
    catch (error) { return accountFail(400, (error as Error).message); }
    const image = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(s.users).where(eq(s.users.id, actor.id)).for('update');
      if (!current || current.suspendedAt) accountFail(403, 'This account is unavailable.');
      await tx.delete(s.profileAvatars).where(eq(s.profileAvatars.userId, actor.id));
      const [saved] = await tx.insert(s.profileAvatars).values({ userId: actor.id, png }).returning();
      const image = '/api/v1/directory/avatars/' + saved!.id;
      await tx.update(s.users).set({ image, updatedAt: nextBusinessVersion(current.updatedAt) }).where(eq(s.users.id, actor.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.avatar-updated', targetId: actor.id, note: 'Profile picture normalized and replaced.' });
      return image;
    });
    return c.json({ image });
  });
  router.delete('/account/avatar', async (c) => {
    const actor = await user(c);
    await db.transaction(async (tx) => {
      await tx.select().from(s.users).where(eq(s.users.id, actor.id)).for('update');
      await tx.update(s.users).set({ image: null, updatedAt: sql`greatest(now(), ${s.users.updatedAt} + interval '1 millisecond')` }).where(eq(s.users.id, actor.id));
      await tx.delete(s.profileAvatars).where(eq(s.profileAvatars.userId, actor.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.avatar-removed', targetId: actor.id, note: 'Profile picture removed.' });
    });
    return c.json({ success: true });
  });
  router.get('/avatars/:id', async (c) => {
    const [image] = await db.select().from(s.profileAvatars).where(eq(s.profileAvatars.id, accountId(c.req.param('id'))));
    if (!image) accountFail(404, 'Picture not found.');
    c.header('Cache-Control', 'no-store'); c.header('Content-Type', 'image/png');
    c.header('X-Content-Type-Options', 'nosniff'); c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(new Uint8Array(Buffer.from(image!.png, 'base64')));
  });
  router.patch('/reviews/:id/privacy', async (c) => {
    const actor = await user(c);
    const input = await body(c, z.object({ anonymous: z.boolean() }).strict());
    await db.transaction(async (tx) => {
      const [review] = await tx.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, accountId(c.req.param('id')))).for('update');
      if (!review || review.reviewerId !== actor.id) accountFail(404, 'Your review was not found.');
      // Privacy changes never change rating, content, publication or the moderation revision.
      await tx.update(s.directoryReviews).set({ anonymous: input.anonymous }).where(eq(s.directoryReviews.id, review.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.privacy-updated', targetId: review.id, note: input.anonymous ? 'Author made this review anonymous publicly.' : 'Author restored their profile identity on this review.' });
    });
    return c.json({ success: true });
  });
  router.post('/account/reviews/anonymous', async (c) => {
    const actor = await user(c);
    await db.transaction(async (tx) => {
      await tx.update(s.directoryReviews).set({ anonymous: true }).where(eq(s.directoryReviews.reviewerId, actor.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'account.reviews-anonymized', targetId: actor.id, note: 'Author made all existing reviews anonymous publicly.' });
    });
    return c.json({ success: true });
  });
}
