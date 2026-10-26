# Get Started

This guide is for the [aa1967/reviews-kits-garden fork](https://github.com/aa1967/reviews-kits-garden),
including its independent public review directory.

## Local development

Install Bun 1.4.4 using the [official installer commands in this fork's README](https://github.com/aa1967/reviews-kits-garden#local-development),
and install Docker with Compose v2. Then run:

```bash
git clone https://github.com/aa1967/reviews-kits-garden.git
cd reviews-kits-garden
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5180` and register. The first account on a fresh database
becomes the administrator. Open its verification email in Mailpit at
`http://localhost:8025`.

The launcher creates a missing local `.env` with generated credentials, starts
PostgreSQL and Mailpit, prepares shared types and the database, and launches the
frontend, API, monitoring worker, and docs. It keeps existing `.env` settings.
A separate full build and manual database setup are unnecessary.

For later starts, use `bun run dev` again. Stop with Ctrl+C; `bun run db:stop`
stops the containers while preserving their data. Redis and Chainguard MinIO
remain optional through `bun run cache:start` and `bun run storage:start`.

See [development details](https://github.com/aa1967/reviews-kits-garden/blob/main/docs/development.md)
for custom settings, service addresses, and troubleshooting.

## Production deployment

Follow this fork's [production deployment guide](https://github.com/aa1967/reviews-kits-garden/blob/main/docs/deployment.md)
for domain and SMTP settings and the two-file Docker launch command. It builds
this repository's API/frontend and includes the monitoring worker.
