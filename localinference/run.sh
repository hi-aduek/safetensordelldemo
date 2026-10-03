#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created localinference/.env. Add CHAT_API_KEY and configure the Whisper endpoint, then rerun."
  exit 1
fi
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
exec uvicorn app:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8010}"
