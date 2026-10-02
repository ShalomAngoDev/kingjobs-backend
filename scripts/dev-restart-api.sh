#!/usr/bin/env bash
# Relance API + affiche les erreurs de boot si crash.
set -euo pipefail
cd "$(dirname "$0")/../.."

docker compose --env-file .env.docker up -d --force-recreate api
echo "Attente démarrage Nest..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS -m 2 http://localhost:3001/api/v1/health/live >/dev/null 2>&1; then
    echo "API OK"
    curl -sS http://localhost:3001/api/v1/health/live
    echo
    exit 0
  fi
  sleep 2
done

echo "API toujours down. Derniers logs :"
docker compose --env-file .env.docker logs api --tail 80
exit 1
