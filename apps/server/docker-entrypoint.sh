#!/bin/sh
set -e

echo "=== ReviewsKits Server Setup ==="

echo "[1/3] Running database migrations..."
bun run dist/migrate.js

if [ "${SEED_ADMIN_ON_START:-false}" = "true" ]; then
  echo "[2/3] Provisioning the explicitly configured admin..."
  bun run dist/seed-admin.js
else
  echo "[2/3] Admin seeding disabled; the first registration on a fresh database becomes administrator."
fi

echo "[3/3] Starting server..."
exec bun run dist/index.js
