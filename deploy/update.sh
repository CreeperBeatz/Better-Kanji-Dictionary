#!/usr/bin/env bash
# Pull the latest main, install deps and restart. Called by the deploy workflow on the Pi's
# self-hosted runner, after it has unpacked the built frontend into web/dist. Safe by hand too.
set -euo pipefail
APP_DIR="${BETTERRTK_APP_DIR:-/home/dani/Better-Kanji-Dictionary}"
cd "$APP_DIR"

echo "== fetch =="
git fetch --quiet origin main
git reset --hard origin/main          # data/, .env, .venv and web/dist are untracked and stay

echo "== deps =="
.venv/bin/pip install -q -r requirements.txt

echo "== restart =="
sudo systemctl restart betterrtk-web
sleep 3
systemctl is-active betterrtk-web
curl -fsS http://127.0.0.1:8766/api/health && echo
echo "deployed $(git rev-parse --short HEAD) at $(date -Is)"
