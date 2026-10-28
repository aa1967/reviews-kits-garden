import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { auth } from '../../../src/infrastructure/auth/auth';
import { db } from '../../../src/infrastructure/database/db';
import * as s from '../../../src/infrastructure/database/schema';
import { directoryRouter } from '../../../src/directory/router';
import { clearDatabase } from '../IntegrationSetup';
import type { DonationAccountData, DonationCurrency, DonationPublicData, DonationRecord } from '@reviewskits/types';

const app = new Hono().route('/directory', directoryRouter);
const addresses = {
  BTC: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  LTC: 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9',
  XMR: '47zQ5LAivg6hNCgijXSEFVLX7mke1bgM6YGLFaANDoJbgXDymcAAZvvMNt2PmMpqEe5qRy2zyfMYXdwpmdyitiFh84xnPG2',
};
type Actor = { id: string; token: string };
let admin: Actor, donor: Actor, other: Actor;
async function actor(name: string, verified = true): Promise<Actor> {
  const result = await auth.api.signUpEmail({ body: { name, email: name + '@example.test', password: 'DonationTestFixture!123' } });
  await db.update(s.users).set({ emailVerified: verified }).where(eq(s.users.id, result.user.id));
  return { id: result.user.id, token: result.token! };
}
function request(path: string, by?: Actor, method = 'GET', input?: unknown, extraHeaders?: Record<string, string>) {
  return app.request('/directory/donations' + path, { method, headers: {
    ...(by ? { Authorization: 'Bearer ' + by.token } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders,
  }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
async function configure(currency: DonationCurrency = 'BTC') {
  const response = await request('/admin/wallets/' + currency, admin, 'PUT', { address: addresses[currency], enabled: true, updatedAt: null });
  expect(response.status).toBe(200);
}
async function leaderboard(enabled: boolean) {
  const [settings] = await db.select().from(s.donationSettings);
  return request('/admin/settings', admin, 'PUT', { leaderboardEnabled: enabled, updatedAt: settings?.updatedAt.toISOString() ?? null });
}
async function prepare(publicCredit = false, coin: DonationCurrency = 'BTC', amount = '1', by = donor) {
  const response = await request('', by, 'POST', { currency: coin, amount, publicCredit, status: 'confirmed', confirmedAtomic: '999999999', userId: admin.id });
  expect(response.status).toBe(201);
  return await response.json() as DonationRecord;
}
async function current(id: string) {
  return (await db.select().from(s.donations).where(eq(s.donations.id, id)))[0]!;
}
async function decide(id: string, transactionId = 'a'.repeat(64), amount = '1') {
  const row = await current(id);
  return request('/admin/' + id + '/decision', admin, 'POST', { status: 'confirmed', transactionId, amount,
    receivedAt: new Date().toISOString(), reason: 'Verified receipt and donor attribution in receiving wallet.', updatedAt: row.updatedAt.toISOString(), walletVerified: true });
}
async function publicData(coin: DonationCurrency = 'BTC', period = 'all') {
  const response = await request('?currency=' + coin + '&period=' + period);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return await response.json() as DonationPublicData;
}
beforeEach(async () => {
  await clearDatabase();
  await db.execute(sql.raw('TRUNCATE donations, donation_wallets, directory_audit CASCADE'));
  admin = await actor('staff'); donor = await actor('supporter'); other = await actor('other');
  expect((await leaderboard(true)).status).toBe(200);
});

describe('Crypto donations and private public credit', () => {
  test('starts with no live addresses and restricts wallet configuration and payment confirmation to current staff', async () => {
    expect((await publicData()).wallets.every((wallet) => !wallet.enabled && !wallet.address)).toBe(true);
    expect((await request('/admin')).status).toBe(401);
    expect((await request('/admin', donor)).status).toBe(403);
    expect((await request('/admin/wallets/BTC', donor, 'PUT', { address: addresses.BTC, enabled: true, updatedAt: null })).status).toBe(403);
    expect((await request('', donor, 'POST', { currency: 'BTC', amount: '1' })).status).toBe(409);
    expect((await request('/admin/wallets/BTC', admin, 'PUT', { address: addresses.LTC, enabled: true, updatedAt: null })).status).toBe(400);
    await configure();
    const data = await prepare();
    expect((await request('/admin/' + data.id + '/decision', donor, 'POST', {})).status).toBe(403);
    await db.update(s.users).set({ isSystemAdmin: false }).where(eq(s.users.id, admin.id));
    expect((await request('/admin', admin)).status).toBe(403);
  });
  test('self-reported payments cannot confirm, inflate amounts, or change the recipient account', async () => {
    await configure();
    const receipt = await prepare(true, 'BTC', '0.1');
    expect(receipt.status).toBe('pending');
    expect((await current(receipt.id)).userId).toBe(donor.id);
    expect((await publicData()).totalAmount).toBe('0');
    const response = await request('/' + receipt.id + '/payment', donor, 'PATCH', { transactionId: 'a'.repeat(64), donorNote: 'Private receipt reference', updatedAt: receipt.updatedAt, status: 'confirmed', publicCredit: true });
    expect(response.status).toBe(200);
    expect((await current(receipt.id)).status).toBe('pending');
    expect((await publicData()).leaders).toHaveLength(0);
    expect((await request('/' + receipt.id + '/payment', other, 'PATCH', { transactionId: 'b'.repeat(64), updatedAt: receipt.updatedAt })).status).toBe(404);
  });
  test('uses actual verified amounts and ranks opt-in totals independently per currency', async () => {
    await configure(); await configure('LTC'); await configure('XMR');
    const first = await prepare(true, 'BTC', '50');
    expect((await decide(first.id, 'a'.repeat(64), '0.1')).status).toBe(200);
    const second = await prepare(true, 'BTC', '0.2');
    expect((await decide(second.id, 'b'.repeat(64), '0.2')).status).toBe(200);
    const anonymous = await prepare(false, 'BTC', '0.5', other);
    expect((await decide(anonymous.id, 'c'.repeat(64), '0.5')).status).toBe(200);
    const litecoin = await prepare(true, 'LTC', '100');
    expect((await decide(litecoin.id, 'd'.repeat(64), '100')).status).toBe(200);
    const monero = await prepare(true, 'XMR', '0.000000000001');
    expect((await decide(monero.id, 'e'.repeat(64), '0.000000000001')).status).toBe(200);
    const data = await publicData();
    expect(data.totalAmount).toBe('0.8');
    expect(data.confirmedCount).toBe(3);
    expect(data.leaders).toEqual([{ rank: 1, name: 'supporter', amount: '0.3', donationCount: 2 }]);
    expect((await publicData('LTC')).totalAmount).toBe('100');
    expect((await publicData('XMR')).totalAmount).toBe('0.000000000001');
  });
  test('defaults to anonymous, keeps private payment details private, and lets only the donor change public visibility', async () => {
    await configure();
    const receipt = await prepare();
    expect(receipt.publicCredit).toBe(false);
    expect((await decide(receipt.id)).status).toBe(200);
    expect((await publicData()).leaders).toHaveLength(0);
    expect((await request('/' + receipt.id + '/visibility', other, 'PATCH', { publicCredit: true })).status).toBe(404);
    expect((await request('/' + receipt.id + '/visibility', donor, 'PATCH', { publicCredit: true })).status).toBe(200);
    let data = await publicData();
    expect(data.leaders[0]!.name).toBe('supporter');
    const serialized = JSON.stringify(data);
    for (const privateValue of [donor.id, receipt.id, 'a'.repeat(64), 'supporter@example.test', 'transactionId', 'donorNote']) expect(serialized).not.toContain(privateValue);
    await request('/hide-all', donor, 'POST', {});
    data = await publicData();
    expect(data.totalAmount).toBe('1');
    expect(data.leaders).toHaveLength(0);
    expect((await (await request('/me', other)).json() as DonationAccountData).donations).toHaveLength(0);
  });
  test('does not let pending duplicate claims block payment verification and serializes duplicate confirmations', async () => {
    await configure();
    const first = await prepare(true), second = await prepare(true, 'BTC', '1', other);
    const results = await Promise.all([decide(first.id), decide(second.id)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await publicData()).totalAmount).toBe('1');
    expect((await publicData()).confirmedCount).toBe(1);
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'donation.confirmed')))).toHaveLength(1);
  });
  test('requires independent wallet verification, prevents stale decisions, and reverses incorrect confirmations', async () => {
    await configure();
    const receipt = await prepare(true);
    expect((await request('/admin/' + receipt.id + '/decision', admin, 'POST', { status: 'confirmed', amount: '1', transactionId: 'a'.repeat(64), receivedAt: new Date().toISOString(), reason: 'This must be independently verified.', updatedAt: receipt.updatedAt })).status).toBe(400);
    expect((await decide(receipt.id)).status).toBe(200);
    expect((await request('/admin/' + receipt.id + '/decision', admin, 'POST', { status: 'reversed', reason: 'Reversing an incorrect receipt entry.', updatedAt: receipt.updatedAt })).status).toBe(409);
    const row = await current(receipt.id);
    expect((await request('/admin/' + receipt.id + '/decision', admin, 'POST', { status: 'reversed', reason: 'Reversing an incorrect receipt entry.', updatedAt: row.updatedAt.toISOString() })).status).toBe(200);
    expect((await publicData()).totalAmount).toBe('0');
    expect((await publicData()).leaders).toHaveLength(0);
    expect((await current(receipt.id)).status).toBe('reversed');
  });
  test('records direct anonymous transfers without granting public account credit, and filters monthly totals by received date', async () => {
    await configure('XMR');
    const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 1); date.setUTCHours(12);
    const response = await request('/admin/received', admin, 'POST', { currency: 'XMR', amount: '3.000000000001', transactionId: 'f'.repeat(64), walletAddress: addresses.XMR,
      receivedAt: date.toISOString(), reason: 'Verified anonymous transfer in Monero wallet.', walletVerified: true, userId: donor.id, publicCredit: true });
    expect(response.status).toBe(201);
    const row = await current((await response.json() as DonationRecord).id);
    expect(row.userId).toBe(null); expect(row.publicCredit).toBe(false);
    expect((await publicData('XMR')).totalAmount).toBe('3.000000000001');
    expect((await publicData('XMR')).leaders).toHaveLength(0);
    expect((await publicData('XMR', 'month')).totalAmount).toBe('0');
  });
  test('wallet rotation preserves receipt addresses and optimistic configuration versions', async () => {
    await configure();
    const receipt = await prepare();
    const [wallet] = await db.select().from(s.donationWallets);
    const update = { address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', enabled: true, updatedAt: wallet!.updatedAt.toISOString() };
    expect((await request('/admin/wallets/BTC', admin, 'PUT', update)).status).toBe(200);
    expect((await request('/admin/wallets/BTC', admin, 'PUT', update)).status).toBe(409);
    expect((await current(receipt.id)).walletAddress).toBe(addresses.BTC);
    expect((await prepare()).walletAddress).toBe(update.address);
  });
  test('rejects wrong precision, invalid receipt dates, historical transaction claims, and cross-origin writes', async () => {
    await configure();
    expect((await request('', donor, 'POST', { currency: 'BTC', amount: '0.000000001' })).status).toBe(400);
    const receipt = await prepare();
    for (const date of [new Date(Date.now() + 86400000), new Date(Date.now() - 3600000)]) {
      expect((await request('/admin/' + receipt.id + '/decision', admin, 'POST', { status: 'confirmed', amount: '1', transactionId: 'a'.repeat(64), receivedAt: date.toISOString(), reason: 'Verify this transfer independently.', updatedAt: receipt.updatedAt, walletVerified: true })).status).toBe(400);
    }
    expect((await request('/hide-all', donor, 'POST', {}, { Origin: 'https://untrusted.example' })).status).toBe(403);
  });
  test('requires verified email for public credit while allowing an unverified donor to withdraw credit', async () => {
    await configure();
    const receipt = await prepare(true);
    await db.update(s.users).set({ emailVerified: false }).where(eq(s.users.id, donor.id));
    expect((await request('', donor, 'POST', { currency: 'BTC', amount: '1' })).status).toBe(403);
    expect((await request('/' + receipt.id + '/visibility', donor, 'PATCH', { publicCredit: false })).status).toBe(200);
    expect((await request('/' + receipt.id + '/visibility', donor, 'PATCH', { publicCredit: true })).status).toBe(403);
  });
  test('account deletion removes public attribution but preserves received totals', async () => {
    await configure();
    const receipt = await prepare(true);
    expect((await decide(receipt.id)).status).toBe(200);
    await db.delete(s.users).where(eq(s.users.id, donor.id));
    expect((await publicData()).leaders).toHaveLength(0);
    expect((await publicData()).totalAmount).toBe('1');
  });
  test('the leaderboard defaults off and can be disabled without disabling donations or leaking saved identities', async () => {
    await db.delete(s.donationSettings);
    expect((await publicData()).leaderboardEnabled).toBe(false);
    expect((await request('/admin/settings', donor, 'PUT', { leaderboardEnabled: true, updatedAt: null })).status).toBe(403);
    await configure();
    expect((await request('', donor, 'POST', { currency: 'BTC', amount: '1', publicCredit: true })).status).toBe(409);
    const receipt = await prepare();
    expect((await decide(receipt.id)).status).toBe(200);
    expect((await publicData()).totalAmount).toBe('1');
    expect((await publicData()).leaders).toHaveLength(0);
    expect((await leaderboard(true)).status).toBe(200);
    expect((await request('/' + receipt.id + '/visibility', donor, 'PATCH', { publicCredit: true })).status).toBe(200);
    expect((await publicData()).leaders[0]!.name).toBe('supporter');
    expect((await leaderboard(false)).status).toBe(200);
    const off = await publicData();
    expect(off.leaderboardEnabled).toBe(false); expect(off.leaders).toHaveLength(0);
    expect(JSON.stringify(off)).not.toContain('supporter');
    expect((await request('/' + receipt.id + '/visibility', donor, 'PATCH', { publicCredit: true })).status).toBe(409);
    expect((await request('/' + receipt.id + '/visibility', donor, 'PATCH', { publicCredit: false })).status).toBe(200);
    expect((await leaderboard(true)).status).toBe(200);
    expect((await publicData()).leaders).toHaveLength(0);
  });
  test('a persistent pseudonym covers every public contribution without changing or exposing the account display name', async () => {
    await configure(); await configure('XMR');
    expect((await request('/identity', donor, 'PUT', { mode: 'pseudonym', pseudonym: 'MoonBadger' })).status).toBe(200);
    expect((await request('/identity', other, 'PUT', { mode: 'pseudonym', pseudonym: 'moonbadger' })).status).toBe(409);
    const first = await prepare(true), second = await prepare(true, 'BTC', '2'), monero = await prepare(true, 'XMR', '0.2');
    expect((await decide(first.id, 'a'.repeat(64), '1')).status).toBe(200);
    expect((await decide(second.id, 'b'.repeat(64), '2')).status).toBe(200);
    expect((await decide(monero.id, 'c'.repeat(64), '0.2')).status).toBe(200);
    expect((await publicData()).leaders).toEqual([{ rank: 1, name: 'MoonBadger', amount: '3', donationCount: 2 }]);
    expect((await publicData('XMR')).leaders[0]!.name).toBe('MoonBadger');
    const privateData = await (await request('/me', donor)).json() as DonationAccountData;
    expect(privateData.identity).toEqual({ mode: 'pseudonym', pseudonym: 'MoonBadger', name: 'MoonBadger' });
    expect((await db.select().from(s.users).where(eq(s.users.id, donor.id)))[0]!.name).toBe('supporter');
    expect(JSON.stringify(await publicData())).not.toContain('supporter');
    expect((await request('/identity', donor, 'PUT', { mode: 'account' })).status).toBe(200);
    expect((await publicData()).leaders[0]!.name).toBe('supporter');
    expect((await request('/identity', donor, 'PUT', { mode: 'pseudonym' })).status).toBe(200);
    expect((await publicData()).leaders[0]!.name).toBe('MoonBadger');
  });
  test('rejects reserved or misleading pseudonyms and unauthenticated identity changes', async () => {
    expect((await request('/identity', undefined, 'PUT', { mode: 'pseudonym', pseudonym: 'Someone' })).status).toBe(401);
    for (const pseudonym of ['admin', '<script>alert(1)</script>', 'a', 'Hidden\u202ename']) {
      expect((await request('/identity', donor, 'PUT', { mode: 'pseudonym', pseudonym })).status).toBe(400);
    }
  });
});
