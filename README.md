<p align="center">
  <a href="https://github.com/aa1967/reviews-kits-garden">
    <img src="apps/docs/docs/public/logo.svg" alt="Reviewskits Logo" width="120" height="120">
  </a>
</p>

<h1 align="center">Reviewskits</h1>

<p align="center">
  A self-hosted public review directory with independent moderation,<br />
  verified business ownership, website monitoring, and embeddable reviews.
</p>

<p align="center">
  <a href="docs/public-directory.md"><strong>Directory Guide</strong></a> ·
  <a href="CONTRIBUTING.md"><strong>Contributing</strong></a> ·
  <a href="https://github.com/aa1967/reviews-kits-garden/pulls"><strong>Pull Requests</strong></a> ·
  <a href="LICENSE"><strong>AGPLv3 License</strong></a>
</p>

This is the **[aa1967/reviews-kits-garden](https://github.com/aa1967/reviews-kits-garden)**
fork of Reviewskits. The instructions below clone and build this repository,
including its public directory features. The original forms, testimonial
workspace, REST API, and React/Vue SDKs remain available.

## Features

- **Public reviews and listings** — Visitors can browse businesses; verified-email accounts can submit reviews.
- **Verified business ownership** — Automated DNS TXT or HTTPS-file checks prove control of a website. Owners can manage profiles, invite colleagues, and reply to reviews.
- **Independent moderation** — Platform administrators control publication, reports, appeals, and ownership disputes. Business owners cannot remove directory reviews.
- **Spam investigation** — A staff dashboard shows explainable risk signals and possible account connections for review.
- **Website monitoring** — Background checks record uptime, confirmed outages, response times, TLS expiry, and DNS changes, with history and alerts.
- **Website integrations** — Businesses can embed overall scores, latest reviews, or clearly labeled selected highlights. Overall scores include every published rating.
- **Original Reviewskits tools** — Custom forms, owner-curated testimonials, API keys, and SDKs remain separate from independent directory scores.

See the [directory guide](docs/public-directory.md) for permissions, workflows,
monitoring limits, and configuration.

## Clone this repository

```bash
git clone https://github.com/aa1967/reviews-kits-garden.git
cd reviews-kits-garden
```

Choose local development or production deployment below. Run all commands from
this checkout's root unless stated otherwise.

## Local development

Requirements: Git, [Bun 1.4.4](https://bun.sh/), and Docker with Docker Compose v2.
Make is optional.

### 1. Configure the environment

```bash
cp .env.example .env
```

Edit `.env` and set the following values. Replace the password and auth-secret
placeholders, and keep the database password consistent in both places. Use a
URL-safe password, or URL-encode it in `DATABASE_URL`.

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace_with_a_local_password
POSTGRES_DB=reviewskits
DATABASE_URL=postgresql://postgres:replace_with_a_local_password@localhost:5433/reviewskits
BETTER_AUTH_SECRET=replace_with_a_random_secret_of_at_least_32_characters
BASE_URL=http://localhost:5180
BETTER_AUTH_URL=http://localhost:3000/api/auth
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=no-reply@reviewskits.local
```

Leave `SMTP_USER` and `SMTP_PASS` unset for local Mailpit. It captures verification
and notification emails locally; it does not deliver them to real inboxes.

### 2. Install, build, and start

```bash
bun install --frozen-lockfile
bun run build
make dev
```

`make dev` starts PostgreSQL and Mailpit, waits for PostgreSQL, applies the
**development** schema, and starts the frontend, API, docs, and monitoring worker.

Without Make, after installing and building, use:

```bash
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d --wait
bun run --cwd apps/server db:push
bun run dev
```

### 3. Create your account

Open `http://localhost:5180/signup` and register. **The first account on a fresh
database becomes the platform administrator.** Open its verification email in
Mailpit at `http://localhost:8025` and follow the link. Setting `ADMIN_EMAIL` and
`ADMIN_PASSWORD` alone does not create an account; explicit provisioning is
explained in the [directory guide](docs/public-directory.md#user-journeys).

| Service | Local address |
| --- | --- |
| Public directory and dashboard | `http://localhost:5180` |
| Original testimonial workspace | `http://localhost:5180/workspace` |
| Staff moderation | `http://localhost:5180/moderation` |
| API / Swagger UI | `http://localhost:3000/ui` |
| Email inbox (Mailpit) | `http://localhost:8025` |
| Documentation | `http://localhost:5173` (check the terminal if that port is busy) |
| PostgreSQL | `localhost:5433` |

### Optional Redis and object storage

Ordinary development startup runs only PostgreSQL and Mailpit in Docker. Redis
and S3-compatible storage are retained as opt-in services; the current directory
and monitoring features use PostgreSQL and do not require either service.

```bash
bun run cache:start       # Redis; also available as make cache
bun run storage:start     # Chainguard MinIO; also available as make storage
bun run cache:stop
bun run storage:stop
```

MinIO uses the maintained [Chainguard image](https://images.chainguard.dev/directory/image/minio/overview)
`cgr.dev/chainguard/minio:latest`. If upgrading an existing MinIO data volume, back
it up and ensure its files are writable by UID 65532 before switching images.

Stop the development command with Ctrl+C, then stop all infrastructure profiles
with `make stop` or `bun run db:stop`. These commands preserve data volumes.
For future image or attachment uploads, a backed-up persistent local folder is
also an option; file uploads are not currently implemented.

## Production deployment

Use the clone above on your server. This setup needs Docker Compose v2, a domain
pointing to the server, ports 80 and 443 available for Traefik/Let's Encrypt, and
a working SMTP service. Bun runs inside the build/runtime images.

### 1. Configure production values

On a fresh checkout, copy `.env.example` to `.env`, then replace its example
values. Use a dedicated production database, a strong unique auth secret, and
your real SMTP settings. For example:

```dotenv
DOMAIN=reviews.example.com
ACME_EMAIL=admin@example.com
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace_with_a_strong_url_safe_password
POSTGRES_DB=reviewskits
DATABASE_URL=postgresql://postgres:replace_with_a_strong_url_safe_password@db:5432/reviewskits
BETTER_AUTH_SECRET=replace_with_a_random_secret_of_at_least_32_characters
BASE_URL=https://reviews.example.com
BETTER_AUTH_URL=https://reviews.example.com/api/auth
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=no-reply@example.com
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SEED_ADMIN_ON_START=false
```

The production database hostname is **`db`**, not `localhost`. Do not reuse local
Mailpit settings or the development database for production.

### 2. Build and launch this fork

Use **both** Compose files so the API and frontend are built from this checkout
and the separate monitoring worker is included:

```bash
docker compose --env-file .env \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.directory.yml up -d --build
```

The base Compose file alone references upstream images that do not contain this
fork's directory features. The overlay above builds this repository's code.
Database migrations run automatically before the API starts.

### 3. Register and operate

Open `https://YOUR_DOMAIN/signup`, create the first administrator account, and
verify its email. No default administrator account is seeded. The deployment
runs Traefik, PostgreSQL, the frontend, the API, and the worker; Redis and MinIO
remain optional. Keep database backups and allow the worker to reach public DNS
and the websites it monitors.

For subsequent code updates, run `git pull --ff-only`, then repeat the same
**two-file** build-and-launch command. Back up the database before applying an
update. See the [production guide](docs/public-directory.md#production) for
native deployment, trusted build certificates, and operational details.

## Development checks

```bash
bun run lint
bun run test:unit    # Database-free checks used by the commit hook
bun run test         # Full suite; creates and removes an isolated test database
bun run build
```

The full test runner requires PostgreSQL and permission to create a test database,
or an explicitly separate `TEST_DATABASE_URL`. It rejects the application database
for integration fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Original testimonial workspace

These screenshots show the retained Reviewskits forms and testimonial tools at
`/workspace`, rather than the new public directory pages.

<table>
  <tr>
    <td width="50%"><img src=".github/assets/image-1.png" alt="Original forms dashboard" width="100%" /></td>
    <td width="50%"><img src=".github/assets/image-2.png" alt="Original testimonial analytics" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/assets/image-3.png" alt="Original form builder" width="100%" /></td>
    <td width="50%"><img src=".github/assets/image-4.png" alt="Original public form" width="100%" /></td>
  </tr>
</table>

## License and attribution

This fork builds on [Reviewskits by the Reviewskits team](https://github.com/reviews-kits-team/reviews-kits).
The covered core is licensed under [AGPLv3](LICENSE). Existing copyright and
licensing notices are retained.
