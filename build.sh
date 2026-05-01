#!/usr/bin/env bash
# build.sh — concatenate src/*.js, write dist/source.js, copy to clipboard.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v go >/dev/null 2>&1; then
    echo "Go is not installed. Install from https://go.dev/dl/ and retry." >&2
    exit 1
fi

go run build.go
