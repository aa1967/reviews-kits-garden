import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from '../../src/infrastructure/database/schema';
import { sql } from 'drizzle-orm';

// Destructive fixtures are allowed only in an explicitly named test database.
// Use the repository runner, which creates a disposable database for each run.
const url = process.env.DATABASE_URL;
if (!url || process.env.NODE_ENV !== 'test') {
  throw new Error('Integration tests require an isolated test database. Run bun run test.');
}
const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!/(^test$|^test_|_test(?:_|$))/.test(databaseName)) {
  throw new Error('Refusing to truncate an application database. Run bun run test.');
}

// In Bun.sql, we pass the URL directly to drizzle
export const testDb = drizzle(url, { schema });

/**
 * Utility to clear all tables in the database to ensure test isolation.
 * Uses CASCADE to handle foreign key constraints.
 */
export async function clearDatabase() {
  const tables = [
    'webhook_logs',
    'webhooks',
    'testimonials',
    'media',
    'forms',
    'api_keys',
    'sessions',
    'accounts',
    'verifications',
    'users',
    'rate_limits'
  ];

  for (const table of tables) {
    await testDb.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }
}

export async function closeConnection() {
  // Bun.sql handles connection pooling automatically
}
