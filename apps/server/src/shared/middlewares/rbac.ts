import type { Context, Next } from "hono";
import { sessionAccount } from './session-account';

/**
 * Middleware to verify if the user is a System Admin (Global).
 */
export const isSystemAdmin = async (c: Context, next: Next) => {
  const account = await sessionAccount(c.req.raw.headers);
  
  if (!account) {
    // Expected 403 for admin routes as per integration tests
    return c.json({ error: "Unauthorized: No session" }, 403);
  }

  // Standard boolean check for isSystemAdmin property
  const isSysAdmin = account.user.isSystemAdmin === true;

  if (!isSysAdmin) {
    return c.json({ error: "Unauthorized: System Admin only" }, 403);
  }
  
  await next();
};
