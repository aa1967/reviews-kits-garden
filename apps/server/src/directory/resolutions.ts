import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';
import { accountFail as fail, accountId, type AccountHelpers } from './account';

export function registerResolutionRoutes(router: Hono, { user, staff, rate, body }: AccountHelpers) {
  router.post('/reviews/:id/resolution', async (c) => {
    const actor = await user(c, true); await rate(actor.id, 'resolution-request', 10);
    const input = await body(c, z.object({ note: z.string().trim().min(10).max(1000), version: z.string().uuid() }).strict());
    const reviewId = accountId(c.req.param('id'));
    const [candidate] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, reviewId));
    if (!candidate) fail(404, 'Review not found.');
    await db.transaction(async (tx) => {
      const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, candidate!.businessId)).for('update');
      if (!site) fail(404, 'Business not found.');
      const members = await tx.select().from(s.directoryMembers).where(eq(s.directoryMembers.businessId, site!.id));
      if (site!.ownerId !== actor.id && !members.some((member) => member.userId === actor.id)) fail(403, 'Only a verified business representative can request a resolution label.');
      const [review] = await tx.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, reviewId)).for('update');
      if (!review || review.status !== 'published') fail(404, 'Published review not found.');
      if (review.reviewerId === actor.id) fail(403, 'You cannot request a resolution label on your own review.');
      if (review.resolutionVersion !== input.version) fail(409, 'This resolution request changed. Refresh before continuing.');
      if (!review.reply) fail(400, 'Post a public business response before requesting a resolution label.');
      if (['requested', 'accepted'].includes(review.resolutionStatus)) fail(409, 'A resolution is already pending or accepted.');
      if (review.resolutionStatus === 'declined' && review.resolutionRespondedAt && Date.now() - review.resolutionRespondedAt.getTime() < 7 * 86400000) fail(409, 'Wait seven days after a declined or withdrawn request before asking again.');
      await tx.update(s.directoryReviews).set({ resolutionStatus: 'requested', resolutionNote: input.note, resolutionRequestedBy: actor.id,
        resolutionRequestedAt: new Date(), resolutionRespondedAt: null, resolutionVersion: randomUUID() }).where(eq(s.directoryReviews.id, reviewId));
      await tx.insert(s.notifications).values({ userId: review.reviewerId, type: 'directory.resolution-request', title: 'Resolution request from ' + site!.name,
        body: site!.domain + ' asks you to confirm a resolution: ' + input.note + ' Open My dashboard to accept or decline. Your score will not change automatically.' });
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.resolution-requested', targetId: reviewId, note: 'Business requested reviewer confirmation: ' + input.note });
    });
    return c.json({ success: true });
  });
  router.post('/reviews/:id/resolution/respond', async (c) => {
    const actor = await user(c);
    const input = await body(c, z.object({ decision: z.enum(['accept', 'decline', 'withdraw']), version: z.string().uuid() }).strict());
    await db.transaction(async (tx) => {
      const [review] = await tx.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, accountId(c.req.param('id')))).for('update');
      if (!review || review.reviewerId !== actor.id) fail(404, 'Your review was not found.');
      if (review.resolutionVersion !== input.version) fail(409, 'This resolution request changed. Refresh before continuing.');
      if (input.decision === 'withdraw' ? review.resolutionStatus !== 'accepted' : review.resolutionStatus !== 'requested') fail(409, 'This resolution request is no longer awaiting that decision.');
      await tx.update(s.directoryReviews).set({ resolutionStatus: input.decision === 'accept' ? 'accepted' : 'declined',
        resolutionRespondedAt: new Date(), resolutionVersion: randomUUID() }).where(eq(s.directoryReviews.id, review.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.resolution-' + input.decision, targetId: review.id,
        note: 'Reviewer chose to ' + input.decision + ' the resolution label. Rating and moderation status were not changed.' });
      const [site] = await tx.select().from(s.directoryBusinesses).where(eq(s.directoryBusinesses.id, review.businessId));
      if (site?.ownerId) await tx.insert(s.notifications).values({ userId: site.ownerId, type: 'directory.resolution-response', title: 'Reviewer resolution response',
        body: site.domain + ': the reviewer chose to ' + input.decision + ' the resolution label.' });
    });
    return c.json({ success: true });
  });
  router.post('/moderation/reviews/:id/resolution', async (c) => {
    const actor = await staff(c);
    const input = await body(c, z.object({ reason: z.string().trim().min(5).max(2000), version: z.string().uuid() }).strict());
    await db.transaction(async (tx) => {
      const [review] = await tx.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, accountId(c.req.param('id')))).for('update');
      if (!review) fail(404, 'Review not found.');
      if (review.resolutionVersion !== input.version) fail(409, 'This resolution changed. Refresh before continuing.');
      await tx.update(s.directoryReviews).set({ resolutionStatus: 'declined', resolutionRespondedAt: new Date(), resolutionVersion: randomUUID() }).where(eq(s.directoryReviews.id, review.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'review.resolution-removed-by-staff', targetId: review.id, note: input.reason });
      await tx.insert(s.notifications).values({ userId: review.reviewerId, type: 'directory.resolution-moderated', title: 'Resolution label or request removed by a moderator', body: input.reason });
    });
    return c.json({ success: true });
  });
}
