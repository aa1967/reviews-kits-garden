# Production deployment

Clone this repository on your server:

```bash
git clone https://github.com/aa1967/reviews-kits-garden.git
cd reviews-kits-garden
```

Run the commands below from the repository root. This setup needs Docker Compose v2, a domain
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
Profile/settings screens, review anonymity, resolutions and user administration
use the same code in development and production. The
`0010_accounts_and_resolutions` migration adds their schema. Small profile pictures
are normalized and stored in PostgreSQL, so they are included in database backups
and need no additional storage service or volume.

### 3. Register and operate

Open `https://YOUR_DOMAIN/signup`, create the first administrator account, and
verify its email. No default administrator account is seeded. The deployment
runs Traefik, PostgreSQL, the frontend, the API, and the worker; Redis and MinIO
remain optional. Keep database backups and allow the worker to reach public DNS
and the websites it monitors.

For subsequent code updates, run `git pull --ff-only`, then repeat the same
**two-file** build-and-launch command. Back up the database before applying an
update. See the [production guide](public-directory.md#production) for
native deployment, trusted build certificates, and operational details.

