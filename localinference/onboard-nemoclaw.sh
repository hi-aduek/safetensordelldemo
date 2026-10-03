#!/usr/bin/env bash
set -euo pipefail

: "${DEEPSEEK_API_KEY:?Set DEEPSEEK_API_KEY in your shell before running this script}"

curl -fsSL https://www.nvidia.com/nemoclaw.sh | \
  NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
  NEMOCLAW_NON_INTERACTIVE=1 \
  NEMOCLAW_AGENT=openclaw \
  NEMOCLAW_PROVIDER=custom \
  NEMOCLAW_ENDPOINT_URL=https://api.deepseek.com/v1 \
  NEMOCLAW_MODEL=deepseek-v4-flash \
  COMPATIBLE_API_KEY="$DEEPSEEK_API_KEY" \
  NEMOCLAW_SANDBOX_NAME=fieldview \
  bash

nemoclaw fieldview status
nemoclaw launch fieldview
