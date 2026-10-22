#!/usr/bin/env bash
# Pull the latest site/config and reload the web server. Does not touch the database.
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d web          # recreates web only if compose/image changed
docker compose exec -T web caddy reload --config /etc/caddy/Caddyfile --force
echo "Updated and reloaded."
