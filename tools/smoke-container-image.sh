#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:-}"
image_label="${2:-published}"
if [[ -z "$image_ref" ]]; then
  echo "Usage: tools/smoke-container-image.sh <image-reference> [label]" >&2
  exit 2
fi

active_container=""
remove_local_image() {
  docker image rm --force "$image_ref" >/dev/null 2>&1 || true
}
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$active_container" ]]; then
    if [[ "$status" -ne 0 ]]; then
      docker logs --tail 200 "$active_container" 2>&1 || true
    fi
    docker rm --force --volumes "$active_container" >/dev/null 2>&1 || true
  fi
  remove_local_image
  exit "$status"
}
trap cleanup EXIT

jwt_secret="$(openssl rand -hex 48)"
settings_key="$(openssl rand -hex 32)"
echo "::add-mask::$jwt_secret"
echo "::add-mask::$settings_key"

for architecture in amd64 arm64; do
  # Docker's classic image store cannot keep two platform variants under the
  # same manifest-list digest. Purge the previous variant before switching
  # architectures so --pull always can materialize the requested platform.
  remove_local_image

  run_id="${GITHUB_RUN_ID:-local}"
  run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
  active_container="phd-atlas-${image_label}-${architecture}-${run_id}-${run_attempt}"
  active_container="$(printf '%s' "$active_container" | tr '[:upper:]_/' '[:lower:]---' | cut -c1-120)"

  docker run --detach \
    --pull always \
    --platform "linux/${architecture}" \
    --name "$active_container" \
    --env NODE_ENV=production \
    --env PORT=4317 \
    --env BASE_URL=https://localhost \
    --env CORS_ORIGIN=https://localhost \
    --env ALLOWED_HOSTS=localhost \
    --env TRUST_PROXY=true \
    --env JWT_SECRET="$jwt_secret" \
    --env SETTINGS_ENCRYPTION_KEY="$settings_key" \
    --publish 127.0.0.1::4317 \
    "$image_ref" >/dev/null

  published_address="$(docker port "$active_container" 4317/tcp | tail -n 1)"
  published_port="${published_address##*:}"
  if ! [[ "$published_port" =~ ^[0-9]+$ ]]; then
    echo "::error title=Container smoke setup failed::Could not resolve the ${architecture} application port."
    exit 1
  fi

  health_path="${RUNNER_TEMP:-/tmp}/phd-atlas-${image_label}-${architecture}-health.json"
  setup_path="${RUNNER_TEMP:-/tmp}/phd-atlas-${image_label}-${architecture}-setup.json"
  ready=false
  for _attempt in $(seq 1 120); do
    if curl --silent --show-error --fail \
      --connect-timeout 1 \
      --max-time 3 \
      --header 'Host: localhost' \
      --header 'X-Forwarded-Proto: https' \
      "http://127.0.0.1:${published_port}/api/health" > "$health_path"; then
      ready=true
      break
    fi
    sleep 2
  done
  if [[ "$ready" != true ]]; then
    echo "::error title=Container health check failed::The ${image_label} linux/${architecture} image did not become healthy."
    exit 1
  fi

  curl --silent --show-error --fail \
    --connect-timeout 2 \
    --max-time 10 \
    --header 'Host: localhost' \
    --header 'X-Forwarded-Proto: https' \
    "http://127.0.0.1:${published_port}/api/setup/status" > "$setup_path"

  HEALTH_PATH="$health_path" SETUP_PATH="$setup_path" ARCHITECTURE="$architecture" node <<'NODE'
const fs = require('node:fs')
const health = JSON.parse(fs.readFileSync(process.env.HEALTH_PATH, 'utf8'))
const setup = JSON.parse(fs.readFileSync(process.env.SETUP_PATH, 'utf8'))
if (health?.ok !== true || health?.data?.status !== 'ok') {
  throw new Error(`linux/${process.env.ARCHITECTURE} returned an invalid /api/health payload.`)
}
if (setup?.ok !== true || setup?.data?.required !== true) {
  throw new Error(`Fresh linux/${process.env.ARCHITECTURE} container did not require one-time /admin setup.`)
}
NODE

  docker rm --force --volumes "$active_container" >/dev/null
  active_container=""
  remove_local_image
  echo "Verified ${image_label} linux/${architecture}: healthy and awaiting one-time /admin setup."
done

trap - EXIT
