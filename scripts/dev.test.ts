import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('development refuses to launch the website when PostgreSQL is unreachable and keeps credentials out of errors', () => {
  const secret = 'credential-that-must-stay-private';
  const result = Bun.spawnSync([process.execPath, 'run', 'dev:app'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://dev:' + secret + '@127.0.0.1:1/reviewskits_test',
      NODE_ENV: 'test',
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10000,
  });
  const output = result.stdout.toString() + result.stderr.toString();
  expect(result.exitCode).not.toBe(0);
  expect(output).toContain('Cannot connect to PostgreSQL at 127.0.0.1:1');
  expect(output).not.toContain(secret);
  expect(output).not.toContain('API Server ready');
  expect(output).not.toContain('[Directory worker] Starting');
});
