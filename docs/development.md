# Development details

For ordinary local use, follow the four commands in the [README](../README.md#local-development).
`bun run dev` and `make dev` use the same launcher. A full production build is
not required to launch development.
The README includes Bun's official installer commands for Debian/Linux, macOS,
and Windows; the project uses Bun 1.4.4.

## What startup does

1. Creates `.env` only if missing, with random local database/auth credentials
   and Mailpit settings. It never replaces an existing file.
2. Starts PostgreSQL and Mailpit using the development Compose file and waits
   up to 60 seconds for them to become ready.
3. Uses Docker's published database port on `127.0.0.1`, builds shared types,
   and prepares the local database schema.
4. Verifies a real connection with Bun's SQL driver, then starts the frontend,
   API, monitoring worker, and documentation server.

PostgreSQL and Mailpit keep running after Ctrl+C so restarting the app is quick.
Run `bun run db:stop` or `make stop` to stop infrastructure while preserving volumes.

| Service | Address |
| --- | --- |
| Directory and dashboard | `http://localhost:5180` |
| Original testimonial workspace | `http://localhost:5180/workspace` |
| Staff moderation | `http://localhost:5180/moderation` |
| API / Swagger UI | `http://localhost:3000/ui` |
| Mailpit inbox | `http://localhost:8025` |
| Documentation | `http://localhost:5173` (or the port printed in the terminal) |
| PostgreSQL | `localhost:5433` |

Register at `/signup`; the first account on a fresh database becomes the
administrator. Verify its email using the Mailpit inbox. An existing database
keeps its existing accounts and administrator.

## Existing or custom configuration

The launcher keeps existing `.env` values and inherited environment variables.
For its Docker-managed database it aligns the runtime connection with the actual
published port using IPv4 loopback, and passes that URL consistently to schema
setup, the API, and the worker. This also handles an older local `.env` pointing
to a different port, without rewriting that file or changing its credentials.
Its database setup accepts only a local PostgreSQL URL and refuses production
mode. If a reused database volume rejects its password, use the credentials
originally used to create that volume; changing `.env` alone does not change a
PostgreSQL account's password.

For an existing local `.env`, check that `BASE_URL=http://localhost:5180`,
`BETTER_AUTH_URL=http://localhost:3000/api/auth`, `SMTP_HOST=127.0.0.1`,
`SMTP_PORT=1025`, and `SMTP_FROM=no-reply@reviewskits.local`. Leave SMTP credentials
empty when using Mailpit. Production settings belong in a separate deployment.

If infrastructure and the database are already managed separately, use
`bun run dev:app` to start just the development processes. Build shared types once
with `bun run build --filter=@reviewskits/types` when using that advanced path.

Docker must be installed and its daemon running. If startup reports a port
conflict, stop the conflicting service or adjust your local Compose ports and
matching `.env` URLs. Startup errors stop the launcher instead of waiting forever.
If PostgreSQL is unavailable, startup stops with its host and port before launching
the website. It does not print database passwords. Use `bun run dev` for ordinary
startup; `dev:app` expects an already reachable database.

On Debian, `permission denied` for `/var/run/docker.sock` means your current user
cannot start the database. Run `sudo usermod -aG docker "$USER"`, then log out and
back in, or run `newgrp docker` to open a shell with the updated group. Verify
`docker ps` works in that shell, then run `bun run dev`. Docker group membership
grants administrative control over Docker.

## Optional services

`bun run cache:start` enables Redis and `bun run storage:start` enables Chainguard
MinIO. Their corresponding `:stop` commands keep stored data. Both remain optional.
MinIO uses `cgr.dev/chainguard/minio:latest`; when upgrading an old MinIO volume,
back it up and ensure it is writable by UID 65532 before switching images.

## Checks

```bash
bun run lint
bun run test:unit
bun run test
bun run build
```

The commit hook runs lint and database-free unit checks. The full test runner
uses an isolated PostgreSQL test database; see [the directory guide](public-directory.md#development)
for test database configuration. Full builds and tests are development checks,
not required manual startup steps.
