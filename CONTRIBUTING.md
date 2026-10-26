# Contributing to Reviewskits

Thanks for taking the time to contribute. This guide will get you up and running quickly.

---

## Before you start

- Check [existing pull requests](https://github.com/aa1967/reviews-kits-garden/pulls) before starting a change.
- Describe larger changes in a pull request so their scope can be reviewed.
- Read the [Code of Conduct](./CODE_OF_CONDUCT.md)

---

## Setup

**Requirements:**
- [Bun](https://bun.sh) 1.4.4
- [Docker](https://docker.com) >= 24.0
- [Git](https://git-scm.com)
- [Make](https://www.gnu.org/software/make/) (pre-installed on macOS and Linux)

```bash
# 1. Clone this repository (or substitute your own fork URL when contributing)
git clone https://github.com/aa1967/reviews-kits-garden.git
cd reviews-kits-garden

# 2. Install dependencies
bun install --frozen-lockfile

# 3. Copy environment variables
cp .env.example .env
# Configure the database, auth secret, and local Mailpit settings from README.md.

# 4. Build shared packages and start development
bun run build
make dev
```

Follow the [README local setup](README.md#local-development) for the exact `.env`
values and first-account/email verification steps.

`make dev` starts PostgreSQL and Mailpit, waits for the database, pushes the schema,
and starts the app and monitoring worker. Redis and Chainguard MinIO remain
available through the opt-in cache and storage profiles.

Enable them with make cache / bun run cache:start or make storage /
bun run storage:start. Stop an extra service with bun run cache:stop or
bun run storage:stop. These commands retain its data volume.

To stop all infrastructure profiles while retaining data volumes:
```bash
make stop
```

### Windows (without Make)

If you are on Windows and don't have `make`, run these steps manually:

```bash
# Start infrastructure
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d --wait

# Prepare the development schema
bun run --cwd apps/server db:push

# Start the dev server
bun run dev
```

---

## Code Quality & Testing

Before submitting a Pull Request, please ensure your code is clean and tested:

```bash
# Run ESLint and TypeScript checks across all workspaces
bun run lint

# Run the complete suite in an isolated test database
bun run test

# Run the database-free checks used before committing
bun run test:unit
```

---

## Database & Migrations

The API uses **Drizzle ORM** with PostgreSQL. The schema is defined in `apps/server/src/infrastructure/database/schema.ts`.

When you make changes to the database schema:
1. Make sure your local database is running (`docker compose -f infra/docker-compose.dev.yml up -d`).
2. Push your changes to your local DB for testing: `cd apps/server && bunx drizzle-kit push`.
3. (Optional for now) Generate a migration file if required by the core team: `cd apps/server && bunx drizzle-kit generate`.

---

## Workflow

```bash
# 1. Create a branch from main
git checkout -b feat/my-feature
# or
git checkout -b fix/my-bug

# 2. Make your changes

# 3. Commit using conventional commits (see below)
# Note: Husky will automatically run `bun run lint && bun run test:unit` before committing.
# If these checks fail, your commit will be rejected.
git commit -m "feat: add CSV import endpoint"

# 4. Push and open a Pull Request
git push origin feat/my-feature
```

---

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org).

| Prefix | When to use |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Deps, config, tooling |
| `refactor:` | Code change, no new feature or fix |
| `test:` | Adding or updating tests |
| `ci:` | CI/CD changes |

```bash
# Good
git commit -m "feat: add useSubmitReview hook to SDK"
git commit -m "fix: webhook retry not respecting backoff delay"
git commit -m "docs: add self-hosting guide to README"

# Bad
git commit -m "update stuff"
git commit -m "fix bug"
git commit -m "WIP"
```

---

## Project structure

```
reviews-kits-garden/
├── apps/
│   ├── server/        ← Hono API + Better-Auth
│   ├── admin/         ← React + Vite admin dashboard
│   └── docs/          ← Public documentation (WIP)
├── packages/
│   ├── types/         ← shared TypeScript types (@reviewskits/types)
│   ├── sdk-react/     ← React hooks (@reviewskits/react) (WIP)
│   └── sdk-vue/       ← Vue composables (@reviewskits/vue) (post-MVP)
├── infra/             ← Docker Compose files
└── .github/           ← CI, issue templates, PR template
```

---

## Shared Types (`@reviewskits/types`)

We use a dedicated package `packages/types` to share TypeScript interfaces, types, and Zod schemas across the entire monorepo (API, Admin Dashboard, and SDKs). This is our single source of truth.

**The Golden Rule:** Never duplicate a type or schema on the client side (e.g., `apps/admin`) if an equivalent exists or should exist on the server side (`apps/server`). Always extract shared contracts to `packages/types`.

### How to use a shared type:

Import the required type directly from the package in your frontend or backend code:

```typescript
import type { User, Testimonial } from '@reviewskits/types';
// or schemas
import { userSchema } from '@reviewskits/types';
```

### How to add/modify a type:

1. Locate the file in `packages/types/src/` (or create a new domain file).
2. Export your Zod schema and its inferred TypeScript type:
   ```typescript
   export const myNewSchema = z.object({ id: z.string() });
   export type MyNewModel = z.infer<typeof myNewSchema>;
   ```
3. Make sure it is exported in `packages/types/src/index.ts`.
4. Run the build command from the root to generate the `.d.ts` declaration files:
   ```bash
   bun run build
   # or run dev in parallel
   bun run dev
   ```

---

## What you can contribute

**Small changes** — documentation improvements and focused bug fixes are good starting points.

**Bug fixes** — always welcome. Please link the issue in your PR.

**Features** — describe the behavior and scope in your pull request.

**Documentation** — typos, unclear sections, missing examples — all PRs welcome, no issue needed.

**SDKs** — React and Vue SDKs are retained. Discuss additional integrations in a pull request.

---

## Pull Request checklist

Before submitting your PR:

- [ ] Code builds without errors (`bun run build`)
- [ ] Code passes all linting rules (`bun run lint`)
- [ ] All tests pass without errors (`bun run test`)
- [ ] No `console.log` or debug code left
- [ ] No `.env` or secrets committed
- [ ] Documentation updated if needed
- [ ] PR description is filled out

---

## Need help?

Start with the [README](README.md) and [directory guide](docs/public-directory.md).
For a proposed fix, open a [pull request](https://github.com/aa1967/reviews-kits-garden/pulls).
