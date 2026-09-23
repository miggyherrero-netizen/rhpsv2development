#!/bin/sh
set -e

echo "Running migrations..."
npx drizzle-kit push

echo "Seeding database..."
npx tsx src/db/seed.ts

echo "Database initialization complete!"

exec npm start
