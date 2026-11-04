#!/usr/bin/env bash
# Pushes src/db/schema.ts to the PRODUCTION Neon database.
# DATABASE_URL comes from .vercel/.env.production.local (never .env.local — see PROJECT.md),
# so the local dev DB in .env is never touched by this. Extra args go to drizzle-kit push.
# Usage: npm run db:push:prod
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".vercel/.env.production.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — run: npx vercel env pull $ENV_FILE --environment=production" >&2
  exit 1
fi

NEON_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | sed 's/^DATABASE_URL="\(.*\)"$/\1/')
case "$NEON_URL" in
  *neon.tech*) ;;
  *) echo "DATABASE_URL in $ENV_FILE is not a Neon URL — refusing to push" >&2; exit 1 ;;
esac

echo "Pushing schema to production Neon..."
DATABASE_URL="$NEON_URL" npx drizzle-kit push "$@"
