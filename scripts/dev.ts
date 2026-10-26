import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

let active: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    interrupted = true;
    active?.kill(signal);
  });
}

async function run(command: string[], env: NodeJS.ProcessEnv) {
  if (interrupted) process.exit(130);
  active = Bun.spawn(command, { cwd: root, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  const code = await active.exited;
  active = undefined;
  if (interrupted) process.exit(130);
  if (code !== 0) process.exit(code);
}

try {
  const template = await readFile('.env.example', 'utf8');
  const password = randomBytes(24).toString('hex');
  const generated = template
    .replaceAll('your_secure_password', password)
    .replaceAll('your_super_secret_auth_key_min_32_chars', randomBytes(32).toString('hex'));
  try {
    await writeFile('.env', generated, { flag: 'wx', mode: 0o600 });
    console.log('Created .env with generated local credentials and Mailpit email settings.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  // Match Bun's inherited environment while also loading a newly created file.
  const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
  let database: URL;
  try {
    database = new URL(env.DATABASE_URL || '');
  } catch {
    throw new Error('Set a local PostgreSQL DATABASE_URL in .env. See docs/development.md.');
  }
  if (env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(database.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('Development startup only prepares a local PostgreSQL database. Use docs/deployment.md for production.');
  }

  console.log('Starting PostgreSQL and Mailpit...');
  await run(['docker', 'compose', '--env-file', '.env', '-f', 'infra/docker-compose.dev.yml',
    'up', '-d', '--wait', '--wait-timeout', '60'], env);

  console.log('Building shared types...');
  await run([process.execPath, 'run', 'build', '--filter=@reviewskits/types'], env);

  console.log('Preparing the local database...');
  await run([process.execPath, 'run', '--cwd', 'apps/server', 'db:push'], env);

  console.log('Starting development. Website: http://localhost:5180 | Email: http://localhost:8025');
  await run([process.execPath, 'run', 'dev:app'], env);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error('Development startup needs Docker with Compose v2 installed and running.');
  } else {
    console.error(error instanceof Error ? error.message : 'Development startup failed.');
  }
  process.exit(1);
}
