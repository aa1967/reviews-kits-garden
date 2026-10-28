import type { Context, Next } from "hono";
import { sessionAccount } from './session-account';

/**
 * Middleware to verify if the user is authenticated (has a valid session).
 * Returns 401 Unauthorized if no session is found.
 */
export const isAuthenticated = async (c: Context, next: Next) => {
  const account = await sessionAccount(c.req.raw.headers);
  
  if (!account) {
    return c.json({ error: "Unauthorized: Valid session required" }, 401);
  }
  
  // Store session in context for downstream handlers if needed
  c.set("session", { ...account.session, user: { ...account.session.user, name: account.user.name, emailVerified: account.user.emailVerified, isSystemAdmin: account.user.isSystemAdmin } });
  
  await next();
};
