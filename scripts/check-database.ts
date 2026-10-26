import { SQL } from 'bun';

let client: SQL | undefined;
let endpoint = 'the configured host and port';
try {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database URL');
  endpoint = url.hostname + ':' + (url.port || '5432');
  client = new SQL(url.href, { max: 1, connectionTimeout: 5 });
  await client`select 1`;
  console.log('PostgreSQL connection verified.');
} catch {
  console.error('Cannot connect to PostgreSQL at ' + endpoint + '. Development has not started.');
  console.error('Run bun run dev to start the local database. For existing settings, check DATABASE_URL and the database credentials in .env.');
  process.exitCode = 1;
} finally {
  await client?.close();
}
