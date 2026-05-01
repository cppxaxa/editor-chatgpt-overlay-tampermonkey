#!/usr/bin/env bash
# run_app.sh - launches chrome (per appsettings.json) and injects dist/source.js
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v go >/dev/null 2>&1; then
    echo "Go is not installed. Install from https://go.dev/dl/ and retry." >&2
    exit 1
fi

go run run_app.go
