# Reviewskits

A self-hosted public review directory with verified business ownership,
independent moderation, website monitoring, and embeddable review scores.
This is the [aa1967/reviews-kits-garden](https://github.com/aa1967/reviews-kits-garden) fork.

## Local development

You need Docker with Compose v2 running, plus Bun 1.4.4.

Install Bun on **Debian 13 / Ubuntu** using its official installer:

```bash
sudo apt-get update
sudo apt-get install -y curl unzip
curl -fsSL https://bun.sh/install | bash -s -- bun-v1.4.4
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

The last three commands also work on other Linux distributions and macOS with
curl and unzip installed. No paid Bun package repository is required.

<details>
<summary>Windows installation (PowerShell)</summary>

```powershell
& ([scriptblock]::Create((irm https://bun.sh/install.ps1))) -Version 1.4.4
```

Open a new terminal after installation.

</details>

Then launch development:

```bash
git clone https://github.com/aa1967/reviews-kits-garden.git
cd reviews-kits-garden
bun install --frozen-lockfile
bun run dev
```

Open **http://localhost:5180**. The first account you register becomes the
administrator. Open its verification email at **http://localhost:8025**.

`bun run dev` creates a missing `.env` with generated local credentials, starts
PostgreSQL and Mailpit, verifies the database connection and prepares its schema,
builds shared types, then runs the
website, API, monitoring worker, and docs. Existing `.env` settings are kept.
There is no separate full build or manual database setup.

Next time, just run `bun run dev`. `make dev` does the same thing.
Stop the app with Ctrl+C; `bun run db:stop` stops the containers and keeps data.
For custom settings and troubleshooting, see [development details](docs/development.md).

## Features

- Public business listings and reviews from verified-email accounts.
- Automated ownership verification through DNS TXT records or an HTTPS file.
- Administrator-controlled business editing, closure, deletion, review moderation, and spam investigation.
- Dark and light ruby red themes, with dark ruby red as the site default.
- Dashboard profile/settings, small profile pictures, pseudonyms and per-review anonymity.
- Business responses, reviewer-confirmed resolution labels and admin user management.
- Uptime checks, outage history, response times, TLS expiry, and alerts.
- Score badges, latest reviews, and selected highlights to embed on other sites.
- Original forms, testimonial workspace, REST API, and React/Vue SDKs.
- BTC, LTC, and XMR donations, anonymous contributions, and an optional supporter leaderboard with persistent pseudonyms.

See the [directory guide](docs/public-directory.md) for workflows and permissions.
See [administration](docs/administration.md) for business controls and site themes.
See [accounts and resolutions](docs/accounts-and-resolutions.md) for profile settings,
review privacy, business replies and user management in development and production.
See the [donation guide](docs/donations.md) to configure receiving wallets and
optionally enable supporter rankings. Donations are verified by administrators.

## Optional services

Redis and Chainguard MinIO remain available when needed. They stay off by default;
the current directory and monitoring features do not require them.

```bash
bun run cache:start       # Redis
bun run storage:start     # Chainguard MinIO
```

The corresponding `cache:stop` and `storage:stop` commands keep stored data.

## Production deployment

Follow the [production deployment guide](docs/deployment.md) for your domain,
SMTP settings, and Docker launch command. Development defaults are local only.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and contribution instructions.
Built on [Reviewskits](https://github.com/reviews-kits-team/reviews-kits), with
existing copyright notices retained. The covered core is licensed under [AGPLv3](LICENSE).
