import { SQL } from 'bun';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const unitOnly = process.argv.slice(2).includes('--unit');
const files = [...new Bun.Glob('tests/**/*.test.ts').scanSync(serverDir)]
  .filter((file) => !unitOnly || file.startsWith('tests/unit/')).sort();
if (!files.length) throw new Error('No server tests found.');

// Unit tests must fail if they accidentally try to access a real database.
const unitUrl = 'postgresql://unit:unit@127.0.0.1:1/unit_test';
const env = { ...process.env, NODE_ENV: 'test', SMTP_HOST: '', DATABASE_URL: unitUrl };
let maintenance: SQL | undefined;
let createdDatabase: string | undefined;
let failed = 0;

function databaseIdentity(url: URL) {
  return [url.hostname.toLowerCase(), url.port || '5432', decodeURIComponent(url.pathname)].join(':');
}

try {
  if (!unitOnly) {
    const configured = process.env.TEST_DATABASE_URL;
    let target: URL;
    if (configured) {
      target = new URL(configured);
      const name = decodeURIComponent(target.pathname.slice(1));
      if (!/(^test$|^test_|_test(?:_|$))/.test(name)) throw new Error('TEST_DATABASE_URL must name an explicitly separate test database.');
      if (process.env.DATABASE_URL && databaseIdentity(target) === databaseIdentity(new URL(process.env.DATABASE_URL))) {
        throw new Error('TEST_DATABASE_URL must not point to the application database.');
      }
    } else {
      if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for local PostgreSQL, or provide a separate TEST_DATABASE_URL.');
      target = new URL(process.env.DATABASE_URL);
      const admin = new URL(target);
      admin.pathname = '/postgres';
      maintenance = new SQL(admin.href, { connectionTimeout: 10 });
      const name = 'reviewskits_test_' + randomBytes(8).toString('hex');
      try {
        await maintenance.unsafe('CREATE DATABASE "' + name + '"');
      } catch {
        throw new Error('Could not create a disposable test database. Start local PostgreSQL or configure a dedicated TEST_DATABASE_URL.');
      }
      createdDatabase = name;
      target.pathname = '/' + name;
    }
    if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Tests require a PostgreSQL test database.');
    Object.assign(env, {
      DATABASE_URL: target.href, POSTGRES_DB: decodeURIComponent(target.pathname.slice(1)),
      POSTGRES_USER: decodeURIComponent(target.username), POSTGRES_PASSWORD: decodeURIComponent(target.password),
    });
    const schema = Bun.spawn([process.execPath, 'run', 'db:push'], { cwd: serverDir, env, stdout: 'inherit', stderr: 'inherit' });
    if (await schema.exited !== 0) throw new Error('Could not prepare the isolated test schema.');
  }
  for (const file of files) {
    console.log('RUN ' + file);
    const child = Bun.spawn([process.execPath, 'test', file, '--max-concurrency', '1'], {
      cwd: serverDir,
      env: file.startsWith('tests/unit/') ? { ...env, DATABASE_URL: unitUrl } : env,
      stdout: 'inherit', stderr: 'inherit',
    });
    if (await child.exited !== 0) failed++;
  }
  console.log('Server test files: ' + (files.length - failed) + ' passed, ' + failed + ' failed, ' + files.length + ' executed.');
} catch (error) {
  failed++;
  // Never include connection strings or database credentials in failure output.
  const message = error instanceof Error ? error.message : 'Test preparation failed.';
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]'));
} finally {
  if (maintenance) {
    if (createdDatabase) await maintenance.unsafe('DROP DATABASE IF EXISTS "' + createdDatabase + '" WITH (FORCE)');
    await maintenance.close();
  }
}
process.exit(failed ? 1 : 0);
