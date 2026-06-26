#!/usr/bin/env bash
# Provision the no-mistakes validation gate for this repo.
# Idempotent and safe to run every session. This container is ephemeral, so the
# CLI is reinstalled each session if missing, then the repo gate is initialized.
set -euo pipefail

export PATH="$HOME/go/bin:$PATH"

if ! command -v no-mistakes >/dev/null 2>&1; then
  if command -v go >/dev/null 2>&1; then
    echo "no-mistakes: installing CLI (first run can take a few minutes)…" >&2
    GOBIN="$HOME/go/bin" go install github.com/kunchenguid/no-mistakes/cmd/no-mistakes@v1.30.2
  else
    echo "no-mistakes: Go toolchain not found; skipping install." >&2
    exit 0
  fi
fi

# Initialize (or repair) the gate for this repo. Idempotent.
no-mistakes init >/dev/null 2>&1 || true
