import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { isSystemAdmin } from '../../../src/shared/middlewares/rbac';
import { auth } from '../../../src/infrastructure/auth/auth';
import { db } from '../../../src/infrastructure/database/db';
import { users } from '../../../src/infrastructure/database/schema';
import { clearDatabase } from '../IntegrationSetup';

const app = new Hono();
app.use('*', isSystemAdmin);
app.get('/admin', (c) => c.json({ ok: true }));
let admin: { id: string; token: string }, member: { id: string; token: string };
async function actor(email: string) {
  const result = await auth.api.signUpEmail({ body: { email, name: 'Permission fixture', password: 'Permission-Fixture-123' } });
  return { id: result.user.id, token: result.token! };
}
function request(token?: string) { return app.request('/admin', { headers: token ? { Authorization: 'Bearer ' + token } : {} }); }
beforeEach(async () => { await clearDatabase(); admin = await actor('admin@example.test'); member = await actor('member@example.test'); });
describe('Database-backed administrator route protection', () => {
  test('allows the active administrator', async () => { expect((await request(admin.token)).status).toBe(200); });
  test('denies an ordinary account and an anonymous visitor', async () => {
    expect((await request(member.token)).status).toBe(403); expect((await request()).status).toBe(403);
  });
  test('demotion takes effect for an existing session', async () => {
    await db.update(users).set({ isSystemAdmin: false }).where(eq(users.id, admin.id));
    expect((await request(admin.token)).status).toBe(403);
  });
  test('suspension takes effect even before a session is removed', async () => {
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, admin.id));
    expect((await request(admin.token)).status).toBe(403);
  });
  test('deleted accounts cannot use an existing bearer token', async () => {
    await db.delete(users).where(eq(users.id, admin.id)); expect((await request(admin.token)).status).toBe(403);
  });
});
