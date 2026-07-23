#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:-}"
expected_digest="${2:-}"
attempts="${3:-20}"
delay_seconds="${4:-3}"

if [[ -z "$image_ref" ]] || ! [[ "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Usage: tools/wait-for-container-digest.sh <image-reference> <sha256-digest> [attempts] [delay-seconds]" >&2
  exit 2
fi
if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || ! [[ "$delay_seconds" =~ ^[0-9]+$ ]]; then
  echo "Attempts must be positive and delay-seconds must be non-negative integers." >&2
  exit 2
fi

last_result="registry query did not complete"
for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if output="$(docker buildx imagetools inspect "$image_ref" 2>&1)"; then
    resolved_digest="$(printf '%s\n' "$output" | awk '$1 == "Digest:" { print $2; exit }')"
    if [[ "$resolved_digest" == "$expected_digest" ]]; then
      printf '%s\n' "$resolved_digest"
      exit 0
    fi
    last_result="${resolved_digest:-no canonical digest returned}"
  else
    last_result="registry query failed"
  fi

  if ((attempt < attempts)); then
    echo "Waiting for $image_ref to resolve to $expected_digest (attempt $attempt/$attempts; last: $last_result)." >&2
    sleep "$delay_seconds"
  fi
done

echo "::error title=Container digest verification timed out::$image_ref did not resolve to $expected_digest after $attempts attempts (last: $last_result)." >&2
exit 1
