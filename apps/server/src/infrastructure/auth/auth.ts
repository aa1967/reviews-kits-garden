import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { APIError } from 'better-auth/api';
import { eq, sql } from "drizzle-orm";
import { db } from "../database/db";
import * as schema from "../database/schema";
import { mailConfigured, publicBaseUrl, sendDirectoryMail } from "../../directory/mail";

const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === 'test' ? 'test-secret-must-be-at-least-32-characters-long' : undefined);
if (!secret) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required for session encryption. Please set it in your .env file.");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  emailVerification: {
    sendOnSignUp: process.env.NODE_ENV !== 'test' && mailConfigured(),
    sendVerificationEmail: async ({ user, url }) => {
      await sendDirectoryMail(user.email, "Verify your Reviewskits account", "Verify your email to write reviews or claim a website:\n\n" + url);
    },
  },
  plugins: [
    bearer(),
  ],
  user: {
    additionalFields: {
      isSystemAdmin: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [account] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
          if (!account || account.suspendedAt) throw new APIError('FORBIDDEN', { message: 'This account is suspended. Contact platform support.' });
        },
        after: async (session) => {
          const [account] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
          if (!account || account.suspendedAt) {
            await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
            throw new APIError('FORBIDDEN', { message: 'This account is suspended. Contact platform support.' });
          }
          await db.update(schema.users).set({ lastSignInAt: new Date() }).where(eq(schema.users.id, session.userId));
          await db.insert(schema.directoryAudit).values({ actorId: session.userId, targetId: session.userId, action: 'account.signed-in', note: 'Successful account sign-in.' });
        },
      },
    },
    user: {
      create: {
        before: async (user) => {
          // Strictly allow only defined schema fields
          const allowedFields = ['id', 'name', 'email', 'emailVerified', 'image', 'isSystemAdmin', 'createdAt', 'updatedAt'];
          const userData: any = {};

          for (const field of allowedFields) {
            if ((user as any)[field] !== undefined) {
              userData[field] = (user as any)[field];
            }
          }

          await db.transaction(async (tx) => {
            const [result] = await tx
              .select({ count: sql<number>`count(*)` })
              .from(schema.users);
            
            if (result && Number(result.count) === 0) {
              userData.isSystemAdmin = true;
            }
          });

          return { data: userData };
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  // Secret for session encryption/signing
  secret,
  // Base URL for auth endpoints
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000/api/auth",
  trustedOrigins: [
    publicBaseUrl(),
    ...(process.env.AUTH_TRUSTED_ORIGINS
    ? process.env.AUTH_TRUSTED_ORIGINS.split(',').map(o => o.trim())
    : [
        "http://localhost:5180", // Admin Frontend
        "http://localhost:3000", // Swagger / Local API
        "http://localhost",       // Tests
        "http://localhost:5174",
      ]),
  ],
});
