#!/usr/bin/env bash
# Active le simulateur paiement DEV + applique la migration payments.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> Recreate API (PAYMENT_PROVIDER=mock + migrate)"
docker compose --env-file .env.docker up -d --force-recreate api

echo "==> Wait API"
sleep 8

echo "==> Ensure prisma client + migrate"
docker compose --env-file .env.docker exec api npx prisma generate
docker compose --env-file .env.docker exec api npx prisma migrate deploy

echo "==> Check PAYMENT_PROVIDER"
docker compose --env-file .env.docker exec api printenv PAYMENT_PROVIDER

echo "OK. Recharge /espace-client/missions/<id>/paiement"
