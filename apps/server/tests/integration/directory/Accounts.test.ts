import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { Jimp } from 'jimp';
import type { ProfileSettings } from '@reviewskits/types';
import { auth } from '../../../src/infrastructure/auth/auth';
import { db } from '../../../src/infrastructure/database/db';
import * as s from '../../../src/infrastructure/database/schema';
import { directoryRouter } from '../../../src/directory/router';
import { clearDatabase } from '../IntegrationSetup';

const app = new Hono().route('/directory', directoryRouter);
type Actor = { id: string; token: string; email: string };
let admin: Actor, owner: Actor, reviewer: Actor, other: Actor;
async function actor(email: string): Promise<Actor> {
  const result = await auth.api.signUpEmail({ body: { email, name: email.split('@')[0]!, password: 'Accounts-Fixture-7439' } });
  await db.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, result.user.id));
  return { id: result.user.id, token: result.token!, email };
}
function request(path: string, by?: Actor, method = 'GET', input?: unknown) {
  return app.request('/directory' + path, { method, headers: { ...(by ? { Authorization: 'Bearer ' + by.token } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
async function profile(by: Actor) { return await (await request('/account', by)).json() as ProfileSettings; }
async function saveProfile(by: Actor, changes: object = {}) {
  const data = await profile(by);
  return request('/account', by, 'PATCH', { name: data.user.name, mode: data.identity.mode, pseudonym: data.identity.pseudonym,
    defaultAnonymousReviews: data.identity.defaultAnonymousReviews, notifications: data.notifications, updatedAt: data.user.updatedAt, ...changes });
}
async function listing() {
  const response = await request('/businesses', owner, 'POST', { domain: 'example.com', name: 'Fixture business', category: 'Software' });
  expect(response.status).toBe(201);
  return await response.json() as { id: string; updatedAt: string };
}
const input = { title: 'An honest experience', content: 'The team took several days to respond and eventually answered my question.', rating: 2 };
async function review(siteId: string, by = reviewer, extra: object = {}) {
  const response = await request('/businesses/' + siteId + '/reviews', by, 'POST', { ...input, ...extra });
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}
async function publish(id: string) {
  const [row] = await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, id));
  expect((await request('/moderation/reviews/' + id, admin, 'POST', { status: 'published', reason: 'First-hand account meets publication policy.', updatedAt: row!.updatedAt.toISOString() })).status).toBe(200);
}
async function resolution(id: string) {
  return (await db.select().from(s.directoryReviews).where(eq(s.directoryReviews.id, id)))[0]!;
}
beforeEach(async () => {
  await clearDatabase();
  await db.execute(sql.raw('TRUNCATE directory_businesses, directory_audit CASCADE'));
  admin = await actor('admin@example.test'); owner = await actor('owner@example.test');
  reviewer = await actor('reviewer@example.test'); other = await actor('other@example.test');
});
describe('Profiles and review privacy', () => {
  test('profiles require sign-in, reject privileged fields and stale saves, and keep email private', async () => {
    expect((await request('/account')).status).toBe(401);
    const previous = await profile(reviewer);
    expect((await saveProfile(reviewer, { name: 'New display name', isSystemAdmin: true })).status).toBe(400);
    expect((await saveProfile(reviewer, { name: 'New display name', defaultAnonymousReviews: true })).status).toBe(200);
    expect((await profile(reviewer)).user.name).toBe('New display name');
    expect((await saveProfile(reviewer, { updatedAt: previous.user.updatedAt })).status).toBe(409);
    expect((await profile(other)).identity.defaultAnonymousReviews).toBe(false);
    const response = await request('/account', reviewer);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await saveProfile(reviewer, { email: 'forged@example.test' })).status).toBe(400);
  });
  test('persistent profile pseudonyms are unique, normalized, reserved and separate from donation identity', async () => {
    expect((await saveProfile(reviewer, { mode: 'pseudonym', pseudonym: 'ＲｕｂｙＦｏｘ' })).status).toBe(200);
    expect((await profile(reviewer)).identity).toMatchObject({ mode: 'pseudonym', pseudonym: 'RubyFox', publicName: 'RubyFox' });
    expect((await saveProfile(other, { mode: 'pseudonym', pseudonym: 'rubyfox' })).status).toBe(409);
    expect((await saveProfile(other, { mode: 'pseudonym', pseudonym: 'Administrator' })).status).toBe(400);
    expect((await saveProfile(other, { mode: 'pseudonym', pseudonym: null })).status).toBe(400);
    expect((await saveProfile(reviewer, { mode: 'account' })).status).toBe(200);
    expect((await profile(reviewer)).identity.pseudonym).toBe('RubyFox');
    expect((await db.select().from(s.donationSupporters)).length).toBe(0);
  });
  test('avatar upload normalizes a real picture, changes its public key on replacement, and supports removal', async () => {
    const png = await new Jimp({ width: 200, height: 100, color: 0xba2450ff }).getBuffer('image/png');
    async function upload(bytes: Buffer, contentType = 'image/png') {
      return app.request('/directory/account/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + reviewer.token, 'Content-Type': contentType }, body: new Uint8Array(bytes) });
    }
    const first = await upload(png);
    expect(first.status).toBe(200);
    const image = (await first.json() as { image: string }).image;
    expect(image).not.toContain(reviewer.id);
    const response = await app.request(image.replace('/api/v1/directory', '/directory'));
    expect(response.headers.get('Content-Type')).toBe('image/png'); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const normalized = await Jimp.read(Buffer.from(await response.arrayBuffer()));
    expect(normalized.bitmap.width).toBe(128); expect(normalized.bitmap.height).toBe(128);
    expect((await profile(reviewer)).user.image).toBe(image);
    expect((await upload(png)).status).toBe(200);
    expect((await app.request(image.replace('/api/v1/directory', '/directory'))).status).toBe(404);
    const jpeg = await new Jimp({ width: 80, height: 40, color: 0xba2450ff }).getBuffer('image/jpeg');
    expect((await upload(jpeg, 'image/jpeg')).status).toBe(200);
    expect((await request('/account/avatar', reviewer, 'DELETE')).status).toBe(200);
    expect((await db.select().from(s.profileAvatars)).length).toBe(0);
    expect((await profile(reviewer)).user.image).toBeNull();
    expect((await upload(Buffer.from('<svg onload=\"alert(1)\"/>'), 'image/svg+xml')).status).toBe(400);
    expect((await upload(Buffer.from('invalid PNG'))).status).toBe(400);
    const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16);
    expect((await upload(huge)).status).toBe(400);
    expect((await upload(Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(413);
  });
  test('anonymous review output hides name, pseudonym and picture in public pages and widgets without changing ratings', async () => {
    const site = await listing();
    expect((await saveProfile(reviewer, { mode: 'pseudonym', pseudonym: 'HiddenRuby' })).status).toBe(200);
    const [avatar] = await db.insert(s.profileAvatars).values({ userId: reviewer.id, png: 'fixture' }).returning();
    const image = '/api/v1/directory/avatars/' + avatar!.id;
    await db.update(s.users).set({ image }).where(eq(s.users.id, reviewer.id));
    const id = await review(site.id); await publish(id);
    let publicData = await (await request('/businesses/example.com')).json() as { reviews: { author: string; avatar: string | null }[]; score: { average: number; count: number } };
    expect(publicData.reviews[0]!.author).toBe('HiddenRuby'); expect(publicData.reviews[0]!.avatar).toBe(image);
    const before = await resolution(id);
    expect((await request('/reviews/' + id + '/privacy', other, 'PATCH', { anonymous: true })).status).toBe(404);
    expect((await request('/reviews/' + id + '/privacy', reviewer, 'PATCH', { anonymous: true })).status).toBe(200);
    publicData = await (await request('/businesses/example.com')).json() as typeof publicData;
    expect(publicData.reviews[0]).toMatchObject({ author: 'Anonymous reviewer', avatar: null });
    expect(JSON.stringify(publicData)).not.toContain('HiddenRuby'); expect(JSON.stringify(publicData)).not.toContain(image); expect(JSON.stringify(publicData)).not.toContain(reviewer.email);
    expect(publicData.score).toMatchObject({ count: 1, average: 2 });
    const widget = await (await request('/widgets/example.com?mode=recent')).text();
    expect(widget).toContain('Anonymous reviewer'); expect(widget).not.toContain('HiddenRuby');
    const after = await resolution(id);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime()); expect(after.status).toBe('published');
  });
  test('anonymity defaults apply to new reviews; attribution can be changed after closure and bulk anonymized', async () => {
    const site = await listing();
    expect((await saveProfile(reviewer, { defaultAnonymousReviews: true })).status).toBe(200);
    const id = await review(site.id); await publish(id);
    expect((await resolution(id)).anonymous).toBe(true);
    await db.update(s.directoryBusinesses).set({ reviewsClosed: true }).where(eq(s.directoryBusinesses.id, site.id));
    expect((await request('/reviews/' + id + '/privacy', reviewer, 'PATCH', { anonymous: false })).status).toBe(200);
    expect((await resolution(id)).anonymous).toBe(false);
    expect((await request('/account/reviews/anonymous', reviewer, 'POST', {})).status).toBe(200);
    expect((await resolution(id)).anonymous).toBe(true);
    expect((await resolution(id)).status).toBe('published');
  });
});
describe('Reviewer-confirmed resolutions', () => {
  async function setup() {
    const site = await listing(), id = await review(site.id); await publish(id);
    await db.update(s.directoryBusinesses).set({ ownerId: owner.id }).where(eq(s.directoryBusinesses.id, site.id));
    return { site, id };
  }
  async function requestResolution(id: string, by = owner, extra: object = {}) {
    return request('/reviews/' + id + '/resolution', by, 'POST', { note: 'We discussed the issue and provided a replacement at no charge.', version: (await resolution(id)).resolutionVersion, ...extra });
  }
  async function reply(id: string) {
    expect((await request('/reviews/' + id + '/reply', owner, 'POST', { reply: 'Please contact our support team so we can investigate and put this right.' })).status).toBe(200);
  }
  test('only a verified business representative may request a label, after posting a public response', async () => {
    const { id } = await setup();
    expect((await requestResolution(id, other)).status).toBe(403);
    expect((await requestResolution(id, admin)).status).toBe(403);
    expect((await requestResolution(id)).status).toBe(400);
    await reply(id);
    expect((await requestResolution(id, owner, { rating: 5, status: 'accepted' })).status).toBe(400);
    expect((await requestResolution(id)).status).toBe(200);
    expect((await requestResolution(id)).status).toBe(409);
    const data = await (await request('/businesses/example.com')).json() as { reviews: { resolutionAccepted: boolean; resolutionNote: string | null }[] };
    expect(data.reviews[0]).toMatchObject({ resolutionAccepted: false, resolutionNote: null });
  });
  test('reviewer acceptance is explicit, owner and other accounts cannot accept, and rating never changes automatically', async () => {
    const { id } = await setup(); await reply(id); await requestResolution(id);
    const pending = await resolution(id);
    for (const by of [owner, other, admin]) expect((await request('/reviews/' + id + '/resolution/respond', by, 'POST', { decision: 'accept', version: pending.resolutionVersion })).status).toBe(404);
    expect((await request('/reviews/' + id + '/resolution/respond', reviewer, 'POST', { decision: 'accept', version: pending.resolutionVersion })).status).toBe(200);
    const accepted = await resolution(id);
    expect(accepted.rating).toBe(2); expect(accepted.status).toBe('published'); expect(accepted.updatedAt.getTime()).toBe(pending.updatedAt.getTime());
    const data = await (await request('/businesses/example.com')).json() as { reviews: { resolutionAccepted: boolean; resolutionNote: string }[]; score: { average: number } };
    expect(data.reviews[0]!.resolutionAccepted).toBe(true); expect(data.reviews[0]!.resolutionNote).toContain('replacement'); expect(data.score.average).toBe(2);
    expect(await (await request('/widgets/example.com?mode=recent')).text()).toContain('Resolution confirmed by reviewer');
    expect((await request('/reviews/' + id + '/resolution/respond', reviewer, 'POST', { decision: 'accept', version: pending.resolutionVersion })).status).toBe(409);
    expect((await request('/reviews/' + id + '/resolution/respond', reviewer, 'POST', { decision: 'withdraw', version: accepted.resolutionVersion })).status).toBe(200);
    expect((await resolution(id)).resolutionStatus).toBe('declined');
    expect((await requestResolution(id)).status).toBe(409);
  });
  test('reviewers may decline, and resolution requests cannot immediately repeat', async () => {
    const { id } = await setup(); await reply(id); await requestResolution(id);
    expect((await request('/reviews/' + id + '/resolution/respond', reviewer, 'POST', { decision: 'decline', version: (await resolution(id)).resolutionVersion })).status).toBe(200);
    expect((await requestResolution(id)).status).toBe(409);
    expect((await resolution(id)).rating).toBe(2);
  });
  test('resolution consent remains available with reviews closed; staff can remove but never forge acceptance', async () => {
    const { site, id } = await setup(); await reply(id);
    await db.update(s.directoryBusinesses).set({ reviewsClosed: true }).where(eq(s.directoryBusinesses.id, site.id));
    expect((await requestResolution(id)).status).toBe(200);
    expect((await request('/reviews/' + id + '/resolution/respond', reviewer, 'POST', { decision: 'accept', version: (await resolution(id)).resolutionVersion })).status).toBe(200);
    expect((await request('/reviews/' + id, reviewer, 'PATCH', { ...input, rating: 5 })).status).toBe(403);
    const version = (await resolution(id)).resolutionVersion;
    expect((await request('/moderation/reviews/' + id + '/resolution', owner, 'POST', { reason: 'Remove this label.', version })).status).toBe(403);
    expect((await request('/moderation/reviews/' + id + '/resolution', admin, 'POST', { reason: 'Forged acceptance.', version, decision: 'accept' })).status).toBe(400);
    expect((await request('/moderation/reviews/' + id + '/resolution', admin, 'POST', { reason: 'Resolution label removed after an independent investigation.', version })).status).toBe(200);
    expect((await resolution(id)).resolutionStatus).toBe('declined');
    expect((await resolution(id)).rating).toBe(2);
    expect((await db.select().from(s.directoryAudit).where(eq(s.directoryAudit.action, 'review.resolution-removed-by-staff'))).length).toBe(1);
  });
});
