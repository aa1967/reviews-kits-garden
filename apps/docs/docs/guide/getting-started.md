# Get Started

This guide is for the [aa1967/reviews-kits-garden fork](https://github.com/aa1967/reviews-kits-garden), including its independent public review directory.

---

## 👨‍💻 For Developers (Contributing)

If you want to run Reviewskits locally to build features or fix bugs, follow these steps.

### Prerequisites
- [Bun](https://bun.sh/) (Version 1.4.4)
- [Docker](https://www.docker.com/) (for the database and local email testing)

### Local Environment Setup

1. **Clone and Install**:
```bash
git clone https://github.com/aa1967/reviews-kits-garden.git
cd reviews-kits-garden
bun install --frozen-lockfile
```

2. **Environment**:
```bash
cp .env.example .env
# Set the database URL/password, auth secret, and local email values below.
```

Set these local development values in `.env`, replacing the password and auth
secret placeholders:

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

Leave SMTP credentials unset for Mailpit. For full configuration details, see
[this fork's README](https://github.com/aa1967/reviews-kits-garden#local-development).

3. **Infrastructure**:
```bash
# Start PostgreSQL and Mailpit
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d --wait

# Prepare the development database schema
bun run --cwd apps/server db:push
```

The optional MinIO service uses cgr.dev/chainguard/minio:latest and keeps the
same S3 endpoint, console port and data volume. Chainguard runs it as UID 65532.
If you already have a volume from the old image, back it up before upgrading and
ensure its files are writable by that UID; do not delete the volume to resolve a
permissions error. To refresh the maintained image, run:

    docker compose -f infra/docker-compose.dev.yml pull minio

Redis and MinIO do not start by default. Enable their profiles only when needed:

    bun run cache:start       # Redis
    bun run storage:start     # Chainguard MinIO

Stop an extra service with bun run cache:stop or bun run storage:stop. To stop
every profile while retaining data, use make stop or bun run db:stop.

4. **Build and Run**:
```bash
bun run build
bun run dev
```

Register at `http://localhost:5180/signup`. The first account on a fresh database
becomes the platform administrator. Open its verification email in Mailpit at
`http://localhost:8025` and follow the link.

| Service | URL |
|---------|-----|
| Public directory and dashboard | `http://localhost:5180` |
| API server | `http://localhost:3000` |
| API Swagger UI | `http://localhost:3000/ui` |
| Mailpit inbox | `http://localhost:8025` |
| Documentation | `http://localhost:5173` (or the port printed in the terminal) |

---

## 🐳 Self-hosting (Production)

Reviewskits is fully containerized and easy to deploy on any server.

### Deploy this fork

Use the cloned repository above and follow its
[production configuration](https://github.com/aa1967/reviews-kits-garden#production-deployment).
Set the production database URL to use `db:5432`, configure your domain, auth
secret, public `BASE_URL`, and real SMTP delivery, then run:

```bash
docker compose --env-file .env \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.directory.yml up -d --build
```

Both Compose files are required to build this fork and include its monitoring
worker. The base file alone uses upstream images without the directory changes.
Migrations run automatically on API startup. Create the first administrator
account on the fresh production database and verify its email.

See the [directory production guide](https://github.com/aa1967/reviews-kits-garden/blob/main/docs/public-directory.md#production)
for operational details.

---

## 🔐 Next Steps

Once your instance is running, you can:
- [Create your first collection form](/guide/forms)
- [Moderate your first reviews](/guide/moderation)
- [Integrate our SDKs](/sdk/react)
