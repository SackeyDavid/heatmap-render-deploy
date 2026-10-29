#!/usr/bin/env bash
# Safe wrapper: development theme only. Never --allow-live, push, or publish.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
THEME_DIR="$ROOT/tools/local/shopify/theme"
STORE="heatmap-oauth-dev"
PORT="${SHOPIFY_THEME_DEV_PORT:-9292}"
HOST="${SHOPIFY_THEME_DEV_HOST:-127.0.0.1}"

if [[ ! -d "$THEME_DIR/layout" ]]; then
  echo "Missing Dawn clone at tools/local/shopify/theme — see tools/local/shopify/README.md" >&2
  exit 1
fi

cd "$THEME_DIR"
ARGS=(theme dev --store "$STORE" --host "$HOST" --port "$PORT")
if [[ -n "${SHOPIFY_FLAG_STORE_PASSWORD:-}" ]]; then
  ARGS+=(--store-password "$SHOPIFY_FLAG_STORE_PASSWORD")
else
  echo "Note: SHOPIFY_FLAG_STORE_PASSWORD is unset — preview may fail on the storefront password gate." >&2
  echo "Set it from Admin > Online Store > Preferences (never commit the value)." >&2
fi

exec shopify "${ARGS[@]}"
