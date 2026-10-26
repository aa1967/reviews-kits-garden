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

async function run(command: string[], env: NodeJS.ProcessEnv, capture = false) {
  if (interrupted) process.exit(130);
  active = Bun.spawn(command, { cwd: root, env, stdin: 'inherit', stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' });
  const output = capture && active.stdout instanceof ReadableStream ? await new Response(active.stdout).text() : '';
  const code = await active.exited;
  active = undefined;
  if (interrupted) process.exit(130);
  if (code !== 0) process.exit(code);
  return output;
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
  const compose = ['docker', 'compose', '--env-file', '.env', '-f', 'infra/docker-compose.dev.yml'];
  await run([...compose, 'up', '-d', '--wait', '--wait-timeout', '60'], env);

  // The launcher owns this local database; use Docker's actual host mapping.
  // Keep the same endpoint through schema setup, Turbo, API, and worker.
  const published = await run([...compose, 'port', 'db', '5432'], env, true);
  const port = published.trim().split(/\r?\n/)[0]?.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error('Could not find the development database port. Check Docker Compose.');
  database.hostname = '127.0.0.1';
  database.port = port;
  env.DATABASE_URL = database.href;
  console.log('Using development PostgreSQL at 127.0.0.1:' + port);
  await run([process.execPath, 'scripts/check-database.ts'], env);

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
