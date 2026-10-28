import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { isSystemAdmin } from '../../../src/shared/middlewares/rbac';
import * as lookup from '../../../src/shared/middlewares/session-account';

const app = new Hono();
app.use('*', isSystemAdmin);
app.get('/admin', (c) => c.json({ ok: true }));
const getAccount = spyOn(lookup, 'sessionAccount');
afterEach(() => getAccount.mockReset());
afterAll(() => getAccount.mockRestore());
function account(databaseRole: boolean, cachedRole: boolean) {
  const now = new Date();
  const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture', email: 'fixture@example.test', emailVerified: true, image: null,
    isSystemAdmin: databaseRole, suspendedAt: null, suspensionReason: null, lastSignInAt: null, notificationPrefs: null, createdAt: now, updatedAt: now };
  return { user, session: { user: { ...user, isSystemAdmin: cachedRole }, session: {
    id: 'session-fixture', userId: user.id, token: 'fixture', expiresAt: new Date(Date.now() + 10000), createdAt: now, updatedAt: now,
  } } };
}
describe('Current administrator permissions', () => {
  test('denies missing, removed or suspended accounts', async () => {
    getAccount.mockResolvedValue(null);
    expect((await app.request('/admin')).status).toBe(403);
  });
  test('denies an ordinary account', async () => {
    getAccount.mockResolvedValue(account(false, false));
    expect((await app.request('/admin')).status).toBe(403);
  });
  test('allows a current administrator', async () => {
    getAccount.mockResolvedValue(account(true, true));
    expect((await app.request('/admin')).status).toBe(200);
  });
  test('demotion takes effect despite a cached administrator flag', async () => {
    getAccount.mockResolvedValue(account(false, true));
    expect((await app.request('/admin')).status).toBe(403);
  });
  test('promotion uses the current database role', async () => {
    getAccount.mockResolvedValue(account(true, false));
    expect((await app.request('/admin')).status).toBe(200);
  });
});
