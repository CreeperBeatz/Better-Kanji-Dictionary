#!/usr/bin/env bash
# One-shot setup of betterkanjidictionary.org on the Pi, next to karaoke.rodeo.
# Run as dani, not with sudo. It reuses karaoke.rodeo's cloudflared; the hostname
# betterkanjidictionary.org -> http://127.0.0.1:8766 is added to that tunnel in the Cloudflare dashboard.
#
#   bash deploy/pi-setup.sh                                  # venv, .env, service, sudoers
#   GH_RUNNER_TOKEN=ABC... bash deploy/pi-setup.sh           # ...plus the CI runner
#
# The database is not in git: copy data/betterrtk.sqlite here (or build it with the pipeline).
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
ARCH="$(dpkg --print-architecture)"
REPO_URL="https://github.com/CreeperBeatz/Better-Kanji-Dictionary"
GH_RUNNER_TOKEN="${GH_RUNNER_TOKEN:-$( [ -f "$HOME/.ghrunner-betterrtk" ] && cat "$HOME/.ghrunner-betterrtk" || true )}"
cd "$APP_DIR"

echo "== venv =="
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

echo "== .env =="
if [ ! -f .env ]; then
  cat > .env <<ENV
APP_URL=https://betterkanjidictionary.org
# Without a key, sign-in links are shown in the page instead of mailed -- anyone could sign in as anyone.
RESEND_API_KEY=
MAIL_FROM=Better Kanji Dictionary <no-reply@betterkanjidictionary.org>
BETTERRTK_OWNER_EMAIL=
# OAuth client id (type "Web application"); empty offers email sign-in only.
GOOGLE_CLIENT_ID=
# Semantic search through OpenRouter (GPT-6 Luna); empty hides it.
OPENROUTER_API_KEY=
# Picture search in the drawing editor (pixabay.com/api/docs); empty turns it off.
PIXABAY_API_KEY=
ENV
  echo "  wrote .env -- set RESEND_API_KEY and BETTERRTK_OWNER_EMAIL"
fi
mkdir -p data/associations

echo "== systemd =="
sed "s#__APP_DIR__#$APP_DIR#g; s#__USER__#$USER_NAME#g" deploy/betterrtk-web.service \
  | sudo tee /etc/systemd/system/betterrtk-web.service >/dev/null
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl restart betterrtk-web" | sudo tee /etc/sudoers.d/betterrtk-ci >/dev/null
sudo chmod 440 /etc/sudoers.d/betterrtk-ci
sudo visudo -cf /etc/sudoers.d/betterrtk-ci
sudo systemctl daemon-reload
sudo systemctl enable --now betterrtk-web
sudo systemctl restart betterrtk-web

echo "== GitHub Actions runner (a second one, separate from karaoke's) =="
if [ -n "$GH_RUNNER_TOKEN" ]; then
  mkdir -p "$HOME/actions-runner-betterrtk" && cd "$HOME/actions-runner-betterrtk"
  if [ ! -f ./config.sh ]; then
    if [ -f "$HOME/actions-runner/config.sh" ]; then
      tar -C "$HOME/actions-runner" --exclude='_work' --exclude='_diag' --exclude='.runner' --exclude='.credentials*' --exclude='.service' -cf - . | tar xf -
    else
      V=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
      curl -fsSL "https://github.com/actions/runner/releases/download/v$V/actions-runner-linux-$ARCH-$V.tar.gz" | tar xz
    fi
  fi
  ./config.sh --url "$REPO_URL" --token "$GH_RUNNER_TOKEN" --labels betterrtk --name pi --unattended --replace
  sudo ./svc.sh install "$USER_NAME"
  sudo ./svc.sh start
  rm -f "$HOME/.ghrunner-betterrtk"
else
  echo "  skipped (no GH_RUNNER_TOKEN)"
fi

sleep 2
systemctl is-active betterrtk-web
curl -fsS http://127.0.0.1:8766/api/health && echo
