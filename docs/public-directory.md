# Independent public review directory

This fork extends Reviewskits with a public business directory, website ownership claims, independent moderation, abuse investigation, HTTPS monitoring, and portable score/review widgets.

## Choosing the foundation

The comparison used Reviewskits commit 47b7fdd and [ReviewsUp](https://github.com/allenyan513/reviewsup.io) commit 86df8262c1711dc066cc8b776731b406f307bf85.

| Area | Reviewskits | ReviewsUp |
| --- | --- | --- |
| Stack | Bun, Hono, React/Vue SDKs, Drizzle/PostgreSQL | NestJS, Next.js, Prisma/PostgreSQL, React embeds |
| Existing product | Owner-curated testimonials, forms, API, moderation controls | Product testimonials, imports, configurable widgets and several display layouts |
| Public independent directory | Required new permissions, listings, claims and review attribution | Also requires changes to its owner/product review model |
| Embedding | SDK foundation; this fork adds public score badges, latest reviews and selected highlights | More existing widget layouts and a widget builder |
| License | AGPLv3 for the covered core | MIT |

Reviewskits was retained because it was already installed, built, and tested, and its smaller API and existing auth/SDKs provide a working foundation for the requested changes. No ReviewsUp code was copied. ReviewsUp's MIT license is more permissive; the AGPLv3 network-use provisions apply to modifications of the covered application, including offering corresponding source to its remote users.

## User journeys

- Visitors explore businesses and read public reviews without signing in.
- People sign up, confirm their email, add listings, write one review per business, edit their own review, report concerns, and appeal moderation decisions.
- Business representatives prove control of an exact hostname with an expiring DNS TXT record or HTTPS verification file. A domain-matching email is not accepted as ownership proof.
- Successful verification automatically grants business access. Owners can edit the business profile, invite colleagues, reply to published reviews, configure monitoring, and get widget code.
- Platform administrators publish, quarantine, or reject reviews, investigate possible account connections, resolve reports/appeals, edit business profiles, close reviews, mark permanent closures, hide or delete listings, and adjudicate ownership transfers.

First-account administrator bootstrap is retained, as requested. Sign-up cannot supply its own administrator flag. Start production with a fresh production database so the intended first account becomes its administrator; the cloud development database already contains a generated local development administrator. Its credentials remain in the ignored local .env and are not production credentials.

Production startup no longer silently seeds an account with a default password. Optional explicit provisioning requires SEED_ADMIN_ON_START=true plus ADMIN_EMAIL and a configured ADMIN_PASSWORD of at least 12 characters. The seeder does not print the password and exits unsuccessfully if provisioning fails.

## Routes

| Browser path | Purpose |
| --- | --- |
| / | Searchable public directory |
| /signup, /login | Registration and login |
| /business/:domain | Listing, published reviews, ownership wizard and observed uptime |
| /dashboard | Own reviews, claims, businesses, invitations and notifications |
| /business/:domain/manage | Business profile, monitoring, replies, team and widgets |
| /moderation | Staff review queues, evidence, reports/appeals, listings and audit trail |
| /site-settings | Staff default ruby theme settings and links to donation settings |
| /principles | Review, verification, privacy and monitoring disclosures |
| /donate | BTC, LTC and XMR donations, private receipts and optional supporter rankings |
| /donations/manage | Staff receiving wallets, optional leaderboard setting and payment verification |
| /workspace | Original curated-testimonial workspace |

The API prefix is /api/v1/directory. Public endpoints include businesses, businesses/:domain, scores/:domain, widgets/:domain and embed.js. Account endpoints include me and verification-email. Claims, review submissions, edits, reports, replies, invitations and business settings require authenticated server-side authorization. Moderation endpoints require a current database-backed administrator role.

The original forms, testimonial tables, SDK endpoints and workspace are retained. Their owner-curated content is separate from directory_reviews and never contributes to the independent directory's score or widgets.

## Moderation and evidence

See [business administration and site themes](administration.md) for business
editing, closure, deletion, review closure and the dark/light ruby appearance.
Closed reviews retain published content and scores while blocking new submissions
and author edits. Permanent business closure also pauses monitoring. These controls
belong to platform administrators.

New and edited reviews always require platform moderation. Owners can respond and report a review but cannot publish or remove directory reviews. All published ratings, positive and negative, contribute to the overall score. Staff decisions require an explanation, check the review revision to prevent stale approvals, and create an audit record and author notification.

The initial rules examine recent reviews for duplicate/highly similar text, account age, review bursts, disposable-email providers, business-membership overlap, and multiple accounts sharing a network. Expensive similarity checks are bounded to the most recent 500 reviews. A higher score can quarantine a submission; it does not automatically ban anyone or publicly label them a fraudster.

Possible connections and reviewer emails are restricted to platform staff. The server ignores browser-provided identity/network evidence. Network signals use a keyed HMAC and are cleared after 30 days. Untrusted forwarded headers and shared private proxy addresses are not treated as client identity. Configure TRUSTED_PROXY_IPS only for reverse proxies that remove untrusted incoming forwarded headers.

Published reviews display verified-email status where applicable. Domain control, email verification, and purchase verification remain distinct. No purchase-verification claim is made without an actual order integration.

## Ownership verification

Challenges are random, account-bound, exact-host-bound, valid for 24 hours, and automatically retried every five minutes. Concurrent successful claims serialize on the business row, so one claimant cannot overwrite another owner. Shared hosting suffixes such as github.io cannot themselves be claimed.

Keep the TXT record or HTTPS file published. Ownership is rechecked daily. Confirmed absence has a seven-day grace period and an in-app warning. If the proof remains absent, business memberships and outstanding invitations are revoked and monitoring is paused. Resolver failures preserve access and retry; they do not establish loss of ownership.

Team invitation tokens are stored hashed, expire in seven days, bind to the invited verified email, and are single-use. Only the owner or platform staff can invite/remove members. Staff-reviewed transfers revoke prior memberships and unused invitations.

## Monitoring and alerts

The worker process runs separately from HTTP handlers. It uses PostgreSQL leases and SKIP LOCKED to prevent duplicate probes across worker instances. Normal checks run every five minutes; short confirmation retries precede incidents and recoveries. Incident counts represent outages, not failed request counts.

Monitors support an HTTPS URL on the verified hostname and optional expected page text. They observe HTTP status, response time, TLS expiry, DNS address changes, and widget presence in the initial HTML. DNS-change alerts are limited to once a day to avoid flooding owners when CDN addresses rotate. JavaScript-only widgets may not appear in initial HTML.

Raw checks are retained for 90 days. Public views show 24-hour, 7-day and 30-day availability, coverage, observed downtime, incidents and longest incident. History starts when monitoring is enabled. Missed probes and unavailable infrastructure are unknown coverage; gaps do not manufacture uptime. Pausing preserves historical observations. Results are observations from one location, not a multi-region SLA or full browser performance measurement.

Probe destinations are restricted to public HTTPS port 443. All resolved IPv4/IPv6 addresses are checked, the chosen address is pinned while preserving hostname-based TLS verification, and every redirect is revalidated and restricted to the same hostname. Private, reserved, link-local and metadata destinations are blocked. Requests have DNS/request time limits, a redirect limit, a 512 KiB body limit and bounded concurrency. The default platform quota is 100 active monitors.

Alerts create in-app notifications and a durable email outbox. Delivery retries with backoff up to eight times, with at-least-once semantics. SMTP configuration is required to deliver email; queued alerts do not prove successful delivery. The worker heartbeat is visible in the moderation dashboard.

If ordinary DNS is unavailable, DNS_OVER_HTTPS_URL accepts a trusted HTTPS JSON resolver such as https://cloudflare-dns.com/dns-query. Preserve certificate verification and the destination checks. A production probe worker needs network egress to its resolver and monitored public websites. The current cloud environment's package-manager allowlist blocks external DNS/monitoring destinations, so live external ownership and uptime checks have not been established here. Tests cover proof matching, private destinations, redirect escape and DNS rebinding using controlled fixtures.

## Website integrations

The business dashboard provides a live preview and copyable iframe or JavaScript-loader code. These work on ordinary HTML sites, WordPress/custom HTML blocks, and React/Vue/Next.js pages that can render an iframe.

- Overall-score badge: includes every published directory rating.
- Latest reviews: shows recently published reviews.
- Selected highlights: explicitly labeled as selected reviews. Owners can choose up to six published reviews; otherwise this shows recent 4–5-star reviews. Its overall score remains unfiltered.

Widgets always link to the full business page. They disclose that overall scores include every published rating, escape all user text, have a restrictive content security policy, and expose no private key or reviewer email. Published updates may take up to 60 seconds to appear because of public caching. Removing publication automatically removes the review from widgets.

For custom server integrations use GET /api/v1/directory/scores/:domain. Generic widget endpoints do not require private API keys.

## Donations

The [donation guide](donations.md) covers anonymous BTC/LTC/XMR contributions,
manual admin wallet verification, and an optional public leaderboard that is off
by default. Donors may save a persistent pseudonym independent of their review
display name and opt into public credit per donation. Donations do not influence
review scores, ownership, publication, or moderation permissions.

## Development

From a new checkout, run `bun install --frozen-lockfile`, then `bun run dev`.
The launcher creates a missing local `.env` with generated credentials, starts
PostgreSQL and Mailpit, prepares shared types and the local database, and starts
the API, frontend, docs, and worker. `make dev` is an alias. Existing configuration
is kept. See [development details](development.md) for custom setups and the
`dev:app` command for already provisioned environments.

The prepared cloud helper /workspace/.cloud-setup/reviews-kits/install.sh reproduces local installation, PostgreSQL, Mailpit, separate development/test schemas and all workspace builds. The snapshot retains the installed dependencies, not live processes.

The development Compose file also defaults to only PostgreSQL and Mailpit.
Optional Redis and Chainguard MinIO definitions, ports and volumes are retained
behind the cache and storage profiles. Use bun run cache:start or
bun run storage:start to enable them, and cache:stop / storage:stop to pause them
without deleting data. make stop and bun run db:stop include all profiles and
retain their volumes. Production directory deployments require PostgreSQL, the
app, the worker and email delivery; S3 and Redis are not current dependencies.
If uploads are added later, a backed-up persistent local filesystem is a suitable
small-installation option alongside the retained S3-compatible service.

Tests use the tracked server runner in apps/server/scripts/test.ts. From the repository root, run:

    bun run test

The runner creates a uniquely named disposable PostgreSQL database, prepares its schema, executes server test files in separate processes, and removes the temporary database. The application database is never selected for test fixtures. PostgreSQL roles without CREATE DATABASE can use an explicitly separate TEST_DATABASE_URL whose database name contains a test marker. A guard rejects direct integration-test commands pointed at an application database. Test email delivery is disabled by default.

The commit hook runs bun run lint and bun run test:unit, so a commit does not require PostgreSQL or run destructive fixtures. It activates the standard Bun installation path for Git GUIs; the cloud setup also links its installed Bun into ignored node_modules/.bin, which Husky adds to PATH. CI runs all nine builds, lint/type checks and the full server/SDK suite in one prepared checkout using Bun 1.4.4. Turbo does not cache database test results.

Container publishing uses the current GitHub repository owner's registry namespace. SDK/npm publishing is opt-in through the ENABLE_SDK_PUBLISHING repository variable and requires release ownership and NPM_TOKEN; ordinary application pushes do not attempt to publish the upstream npm packages.

## Production

Follow the [production deployment guide](deployment.md) for environment values and launch instructions. Use a dedicated production database, a strong auth secret, real SMTP configuration, your public BASE_URL, and appropriate network egress. Do not copy development accounts, database files or Mailpit configuration into production.

The standard compose file references upstream images, which do not contain this fork's changes. Build this fork using the overlay:

    docker compose --env-file .env \
      -f infra/docker-compose.yml \
      -f infra/docker-compose.directory.yml up -d --build

The overlay builds this fork's API and frontend and adds a separate worker. The existing server entrypoint applies migrations before normal startup. For a native deployment, run the committed migrations from apps/server and supervise the API and worker separately. Use bun run worker to start the worker. Production schema changes should use committed migrations rather than db:push or db:reset.

For builds behind a trusted TLS-inspecting proxy, both Dockerfiles accept an optional BuildKit secret named build_ca containing that proxy's public CA certificate. Pass it with docker build --secret id=build_ca,src=/path/to/trusted-ca.pem. The certificate is available only during dependency installation; it is not copied into the runtime image. TLS and lockfile integrity checks stay enabled.

The checked-in migration is additive and retains existing users, forms and testimonials. Ownership data, review decisions, monitoring history and queued alerts reside in PostgreSQL. Back up that database and keep an external availability monitor for the review platform itself.

Implementation validation includes the real database integration suite, controlled probe/security tests, local SMTP verification, browser registration and signed-link callback, staff publication, live iframe widgets and mobile overflow checks. External production email delivery, real domain proof, real target monitoring, public deployment and publication of the cloud environment still require their actual runtime configuration.

Final checks passed: 138 server tests, eight SDK tests, all nine workspace builds, all four configured lint/type tasks, fresh migrations, an upgrade preserving a legacy user/testimonial, and repeat migration execution. Production-image checks also passed for automatic migration startup without default admin seeding, first-signup administration, bundled local SMTP delivery, the standalone worker heartbeat, and frontend HTML/assets. The API runtime image contains the bundles and migrations rather than the monorepo's development dependencies.
