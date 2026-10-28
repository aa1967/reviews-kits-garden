import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DONATION_CURRENCIES, DONATION_STATUSES, donationAtomicAmount, donationDisplayAmount, type DonationCurrency, type DonationRecord, type DonationSettings, type DonationWallet } from '@reviewskits/types';
import { db } from '../infrastructure/database/db';
import * as s from '../infrastructure/database/schema';
import { validDonationAddress } from './addresses';

type Actor = typeof s.users.$inferSelect;
type Row = typeof s.donations.$inferSelect;
type Helpers = {
  user: (c: Context, verified?: boolean) => Promise<Actor>;
  staff: (c: Context) => Promise<Actor>;
  rate: (actorId: string, scope: string, max: number) => Promise<void>;
  body: <T extends z.ZodType>(c: Context, schema: T) => Promise<z.infer<T>>;
};
const currencySchema = z.enum(DONATION_CURRENCIES);
const amountSchema = z.string().trim().min(1).max(26);
const transactionSchema = z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, 'Enter the 64-character transaction ID from your wallet.');
const reasonSchema = z.string().trim().min(10).max(1000);
const versionSchema = z.string().datetime();
function fail(status: 400 | 403 | 404 | 409, message: string): never { throw new HTTPException(status, { message }); }
function identifier(value: string) {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) fail(400, 'Invalid donation identifier.');
  return result.data!;
}
function currency(value: string): DonationCurrency {
  const result = currencySchema.safeParse(value);
  if (!result.success) fail(400, 'Choose BTC, LTC, or XMR.');
  return result.data!;
}
function atomic(coin: DonationCurrency, value: string) {
  try { return donationAtomicAmount(coin, value); }
  catch (error) { return fail(400, (error as Error).message); }
}
function received(value: string) {
  const result = z.string().datetime().safeParse(value);
  if (!result.success) return fail(400, 'Enter the receipt date in ISO format.');
  const date = new Date(result.data);
  if (date.getTime() < Date.UTC(2009, 0, 3) || date.getTime() > Date.now() + 60000) fail(400, 'The receipt date cannot be in the future.');
  return date;
}
function record(row: Row): DonationRecord {
  return {
    id: row.id, currency: row.currency, walletAddress: row.walletAddress,
    declaredAmount: donationDisplayAmount(row.currency, row.declaredAtomic),
    amount: row.confirmedAtomic === null ? null : donationDisplayAmount(row.currency, row.confirmedAtomic),
    publicCredit: row.publicCredit, status: row.status, transactionId: row.transactionId,
    donorNote: row.donorNote, decisionReason: row.decisionReason,
    receivedAt: row.receivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}
async function wallets(publicOnly = false): Promise<DonationWallet[]> {
  const rows = await db.select().from(s.donationWallets);
  return DONATION_CURRENCIES.map((coin) => {
    const row = rows.find((entry) => entry.currency === coin);
    return { currency: coin, enabled: row?.enabled ?? false, address: publicOnly && !row?.enabled ? '' : row?.address ?? '', updatedAt: publicOnly ? null : row?.updatedAt.toISOString() ?? null };
  });
}
async function settings(): Promise<DonationSettings> {
  const [row] = await db.select().from(s.donationSettings).where(eq(s.donationSettings.id, 'global'));
  return { leaderboardEnabled: row?.leaderboardEnabled ?? false, updatedAt: row?.updatedAt.toISOString() ?? null };
}
function fresh(row: { updatedAt: Date }, expected: string) {
  if (row.updatedAt.getTime() !== new Date(expected).getTime()) fail(409, 'This donation changed. Refresh before saving a decision.');
}
function nextVersion(previous: Date) { return new Date(Math.max(Date.now(), previous.getTime() + 1)); }

export function registerDonationRoutes(router: Hono, { user, staff, rate, body }: Helpers) {
  router.use('/donations/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });

  router.get('/donations', async (c) => {
    c.header('Cache-Control', 'no-store');
    const coin = currency(c.req.query('currency') ?? 'BTC');
    const period = c.req.query('period') ?? 'all';
    if (!['all', 'month'].includes(period)) fail(400, 'Choose all time or this month.');
    const now = new Date();
    const config = await settings();
    const filters = and(eq(s.donations.currency, coin), eq(s.donations.status, 'confirmed'),
      period === 'month' ? gte(s.donations.receivedAt, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) : undefined);
    const [total] = await db.select({ atomic: sql<string>`coalesce(sum(${s.donations.confirmedAtomic}), 0)::text`, count: count() }).from(s.donations).where(filters);
    const leaders = config.leaderboardEnabled ? await db.select({
      name: sql<string>`case when ${s.donationSupporters.nameMode} = 'pseudonym' then ${s.donationSupporters.pseudonym} else ${s.users.name} end`,
      atomic: sql<string>`sum(${s.donations.confirmedAtomic})::text`, count: count() })
      .from(s.donations).innerJoin(s.users, eq(s.users.id, s.donations.userId))
      .leftJoin(s.donationSupporters, eq(s.donationSupporters.userId, s.donations.userId))
      .where(and(filters, eq(s.donations.publicCredit, true))).groupBy(s.donations.userId, s.users.name, s.donationSupporters.nameMode, s.donationSupporters.pseudonym)
      .orderBy(sql`sum(${s.donations.confirmedAtomic}) desc`, sql`min(${s.donations.receivedAt}) asc`, s.donations.userId).limit(50) : [];
    return c.json({
      wallets: await wallets(true), leaderboardEnabled: config.leaderboardEnabled, currency: coin, period, totalAmount: donationDisplayAmount(coin, total!.atomic), confirmedCount: Number(total!.count),
      leaders: leaders.map((entry, i) => ({ rank: i + 1, name: entry.name, amount: donationDisplayAmount(coin, entry.atomic), donationCount: Number(entry.count) })),
    });
  });

  router.get('/donations/me', async (c) => {
    const actor = await user(c);
    const rows = await db.select().from(s.donations).where(eq(s.donations.userId, actor.id)).orderBy(desc(s.donations.createdAt)).limit(100);
    const [profile] = await db.select().from(s.donationSupporters).where(eq(s.donationSupporters.userId, actor.id));
    return c.json({ donations: rows.map(record), identity: {
      mode: profile?.nameMode ?? 'account', pseudonym: profile?.pseudonym ?? null,
      name: profile?.nameMode === 'pseudonym' ? profile.pseudonym! : actor.name,
    } });
  });
  router.put('/donations/identity', async (c) => {
    const actor = await user(c, true); await rate(actor.id, 'donation-identity', 10);
    const input = await body(c, z.object({ mode: z.enum(['account', 'pseudonym']), pseudonym: z.string().max(80).optional() }));
    const [existing] = await db.select().from(s.donationSupporters).where(eq(s.donationSupporters.userId, actor.id));
    let pseudonym = existing?.pseudonym ?? null;
    if (input.mode === 'pseudonym') {
      pseudonym = (input.pseudonym ?? pseudonym ?? '').normalize('NFKC').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,38}[A-Za-z0-9]$/.test(pseudonym)) fail(400, 'Use 3–40 letters, numbers, spaces, dots, underscores, or hyphens for your pseudonym.');
      if (['anonymous', 'admin', 'administrator', 'moderator', 'staff', 'system', 'reviewskits'].includes(pseudonym.toLowerCase())) fail(400, 'Choose a different supporter pseudonym.');
    }
    await db.transaction(async (tx) => {
      await tx.insert(s.donationSupporters).values({ userId: actor.id, nameMode: input.mode, pseudonym })
        .onConflictDoUpdate({ target: s.donationSupporters.userId, set: { nameMode: input.mode, pseudonym, updatedAt: new Date() } });
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.identity-updated', targetId: actor.id, note: 'Donor updated their persistent leaderboard identity.' });
    });
    return c.json({ success: true });
  });
  router.post('/donations', async (c) => {
    const actor = await user(c, true); await rate(actor.id, 'donation-receipt', 5);
    const input = await body(c, z.object({ currency: currencySchema, amount: amountSchema, publicCredit: z.boolean().default(false) }));
    if (input.publicCredit && !(await settings()).leaderboardEnabled) fail(409, 'The public leaderboard is not enabled. You can still donate anonymously.');
    const declaredAtomic = atomic(input.currency, input.amount);
    const [wallet] = await db.select().from(s.donationWallets).where(eq(s.donationWallets.currency, input.currency));
    if (!wallet?.enabled || !wallet.address) fail(409, 'Donations in this currency are not available yet.');
    const row = await db.transaction(async (tx) => {
      const [entry] = await tx.insert(s.donations).values({ userId: actor.id, currency: input.currency, walletAddress: wallet.address, declaredAtomic, publicCredit: input.publicCredit }).returning();
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.prepared', targetId: entry!.id, note: 'Private donation receipt prepared; payment is not confirmed.' });
      return entry!;
    });
    return c.json(record(row), 201);
  });
  router.patch('/donations/:id/payment', async (c) => {
    const actor = await user(c); await rate(actor.id, 'donation-payment', 20);
    const input = await body(c, z.object({ transactionId: transactionSchema, donorNote: z.string().trim().max(500).default(''), updatedAt: versionSchema }));
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(s.donations).where(and(eq(s.donations.id, identifier(c.req.param('id'))), eq(s.donations.userId, actor.id))).for('update');
      if (!row) fail(404, 'Donation not found.');
      fresh(row, input.updatedAt);
      if (row.status !== 'pending') fail(409, 'Payment details can only be added while verification is pending.');
      await tx.update(s.donations).set({ transactionId: input.transactionId, donorNote: input.donorNote, updatedAt: nextVersion(row.updatedAt) }).where(eq(s.donations.id, row.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.payment-reported', targetId: row.id, note: 'Payment details submitted for independent wallet verification.' });
    });
    return c.json({ success: true });
  });
  router.patch('/donations/:id/visibility', async (c) => {
    const input = await body(c, z.object({ publicCredit: z.boolean() }));
    const actor = await user(c, input.publicCredit);
    if (input.publicCredit && !(await settings()).leaderboardEnabled) fail(409, 'The public leaderboard is not enabled. Donations can still be made anonymous.');
    const [row] = await db.update(s.donations).set({ publicCredit: input.publicCredit, updatedAt: sql`greatest(now(), ${s.donations.updatedAt} + interval '1 millisecond')` })
      .where(and(eq(s.donations.id, identifier(c.req.param('id'))), eq(s.donations.userId, actor.id))).returning();
    if (!row) fail(404, 'Donation not found.');
    return c.json({ success: true });
  });
  router.post('/donations/hide-all', async (c) => {
    const actor = await user(c);
    await db.update(s.donations).set({ publicCredit: false, updatedAt: sql`greatest(now(), ${s.donations.updatedAt} + interval '1 millisecond')` }).where(eq(s.donations.userId, actor.id));
    return c.json({ success: true });
  });

  router.get('/donations/admin', async (c) => {
    await staff(c);
    const status = c.req.query('status') ?? 'pending';
    if (status !== 'all' && !DONATION_STATUSES.includes(status as typeof DONATION_STATUSES[number])) fail(400, 'Invalid donation status.');
    const page = Math.min(1000, Math.max(1, Math.floor(Number(c.req.query('page')) || 1)));
    const filters = status === 'all' ? undefined : eq(s.donations.status, status as typeof DONATION_STATUSES[number]);
    const rows = await db.select({ donation: s.donations, donor: { name: s.users.name, email: s.users.email } }).from(s.donations)
      .leftJoin(s.users, eq(s.donations.userId, s.users.id)).where(filters).orderBy(desc(s.donations.createdAt)).limit(30).offset((page - 1) * 30);
    const [total] = await db.select({ count: count() }).from(s.donations).where(filters);
    const counts = await db.select({ status: s.donations.status, count: count() }).from(s.donations).groupBy(s.donations.status);
    return c.json({ wallets: await wallets(), settings: await settings(), donations: rows.map((row) => ({ ...record(row.donation), donor: row.donor })), total: Number(total!.count), counts, page });
  });
  router.put('/donations/admin/settings', async (c) => {
    const actor = await staff(c);
    const input = await body(c, z.object({ leaderboardEnabled: z.boolean(), updatedAt: versionSchema.nullable() }));
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(s.donationSettings).where(eq(s.donationSettings.id, 'global')).for('update');
      if (existing && (!input.updatedAt || existing.updatedAt.getTime() !== new Date(input.updatedAt).getTime())) fail(409, 'Donation settings changed. Refresh before saving.');
      if (!existing && input.updatedAt !== null) fail(409, 'Donation settings changed. Refresh before saving.');
      if (existing) await tx.update(s.donationSettings).set({ leaderboardEnabled: input.leaderboardEnabled, updatedBy: actor.id, updatedAt: nextVersion(existing.updatedAt) }).where(eq(s.donationSettings.id, 'global'));
      else {
        const inserted = await tx.insert(s.donationSettings).values({ leaderboardEnabled: input.leaderboardEnabled, updatedBy: actor.id }).onConflictDoNothing().returning();
        if (!inserted.length) fail(409, 'Donation settings changed. Refresh before saving.');
      }
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.leaderboard-' + (input.leaderboardEnabled ? 'enabled' : 'disabled'), targetId: actor.id, note: 'Public donation leaderboard setting updated.' });
    });
    return c.json({ success: true });
  });
  router.put('/donations/admin/wallets/:currency', async (c) => {
    const actor = await staff(c);
    const coin = currency(c.req.param('currency'));
    const input = await body(c, z.object({ address: z.string().trim().max(120), enabled: z.boolean(), updatedAt: versionSchema.nullable() }));
    if ((input.address && !validDonationAddress(coin, input.address)) || (input.enabled && !input.address)) fail(400, 'Enter a valid ' + coin + ' mainnet receiving address with a correct checksum.');
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(s.donationWallets).where(eq(s.donationWallets.currency, coin)).for('update');
      if (existing && (!input.updatedAt || existing.updatedAt.getTime() !== new Date(input.updatedAt).getTime())) fail(409, 'Wallet settings changed. Refresh before saving.');
      if (!existing && input.updatedAt !== null) fail(409, 'Wallet settings changed. Refresh before saving.');
      if (existing) await tx.update(s.donationWallets).set({ address: input.address, enabled: input.enabled, updatedBy: actor.id, updatedAt: nextVersion(existing.updatedAt) }).where(eq(s.donationWallets.currency, coin));
      else {
        const inserted = await tx.insert(s.donationWallets).values({ currency: coin, address: input.address, enabled: input.enabled, updatedBy: actor.id }).onConflictDoNothing().returning();
        if (!inserted.length) fail(409, 'Wallet settings changed. Refresh before saving.');
      }
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.wallet-updated', targetId: actor.id, note: coin + ' receiving address ' + (input.enabled ? 'enabled' : 'disabled') + '.' });
    });
    return c.json({ success: true });
  });
  router.post('/donations/admin/received', async (c) => {
    const actor = await staff(c);
    const input = await body(c, z.object({ currency: currencySchema, amount: amountSchema, transactionId: transactionSchema, walletAddress: z.string().trim().max(120), receivedAt: z.string(), reason: reasonSchema, walletVerified: z.literal(true) }));
    const confirmedAtomic = atomic(input.currency, input.amount), receivedAt = received(input.receivedAt);
    if (!validDonationAddress(input.currency, input.walletAddress)) fail(400, 'Enter the valid mainnet address that received this donation.');
    const row = await db.transaction(async (tx) => {
      const [entry] = await tx.insert(s.donations).values({ currency: input.currency, walletAddress: input.walletAddress, declaredAtomic: confirmedAtomic, confirmedAtomic,
        transactionId: input.transactionId, receivedAt, confirmedAt: new Date(), reviewedBy: actor.id, status: 'confirmed', decisionReason: input.reason }).returning();
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.received-anonymously', targetId: entry!.id, note: input.reason });
      return entry!;
    });
    return c.json(record(row), 201);
  });
  router.post('/donations/admin/:id/decision', async (c) => {
    const actor = await staff(c);
    const input = await body(c, z.object({ status: z.enum(['confirmed', 'rejected', 'reversed']), amount: amountSchema.optional(), transactionId: transactionSchema.optional(),
      receivedAt: z.string().optional(), reason: reasonSchema, updatedAt: versionSchema, walletVerified: z.boolean().optional() }));
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(s.donations).where(eq(s.donations.id, identifier(c.req.param('id')))).for('update');
      if (!row) fail(404, 'Donation not found.');
      fresh(row, input.updatedAt);
      if (input.status === 'reversed' ? row.status !== 'confirmed' : row.status !== 'pending') fail(409, 'This decision is not available for the donation status.');
      const changes: Partial<typeof s.donations.$inferInsert> = { status: input.status, decisionReason: input.reason, reviewedBy: actor.id, updatedAt: nextVersion(row.updatedAt) };
      if (input.status === 'confirmed') {
        if (input.walletVerified !== true) fail(400, 'Verify the transfer and donor attribution in the receiving wallet before confirming.');
        if (!input.amount || !input.transactionId || !input.receivedAt) fail(400, 'Enter the actual amount, transaction ID, and receipt date from the receiving wallet.');
        const receivedAt = received(input.receivedAt);
        if (receivedAt.getTime() < row.createdAt.getTime() - 5 * 60000) fail(400, 'This transfer predates the donation receipt. Verify attribution separately or record it as an anonymous donation.');
        Object.assign(changes, { confirmedAtomic: atomic(row.currency, input.amount), transactionId: input.transactionId, receivedAt, confirmedAt: new Date() });
      }
      await tx.update(s.donations).set(changes).where(eq(s.donations.id, row.id));
      await tx.insert(s.directoryAudit).values({ actorId: actor.id, action: 'donation.' + input.status, targetId: row.id, note: input.reason });
    });
    return c.json({ success: true });
  });
}
