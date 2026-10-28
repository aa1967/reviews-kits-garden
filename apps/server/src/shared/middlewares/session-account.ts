import { eq } from 'drizzle-orm';
import { auth } from '../../infrastructure/auth/auth';
import { db } from '../../infrastructure/database/db';
import { users } from '../../infrastructure/database/schema';

export async function sessionAccount(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (!user || user.suspendedAt) return null;
  return { session, user };
}
