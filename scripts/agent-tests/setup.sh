#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: setup.sh <scenario-id> <agent-id> [run-id]"
  exit 1
fi

SCENARIO_ID="$1"
AGENT_ID="$2"
RUN_ID="${3:-$(date +%Y%m%d-%H%M%S)}"

ROOT_DIR="${AGENT_TEST_ROOT:-"$PWD/runs/shardfall"}"
RUN_DIR="$ROOT_DIR/$SCENARIO_ID/$AGENT_ID/$RUN_ID"
REPO_DIR="$RUN_DIR/repo"
LOG_DIR="$RUN_DIR/logs"

if [ -d "$RUN_DIR" ]; then
  echo "Run directory already exists: $RUN_DIR"
  exit 1
fi

mkdir -p "$RUN_DIR" "$LOG_DIR"
git clone https://github.com/chrhicks/shardfall "$REPO_DIR"

cat <<EOF
Run prepared.

Repo: $REPO_DIR
Logs: $LOG_DIR
CLI:  $PWD/bin/continuum

Next steps:
  export CONTINUUM_CLI="$PWD/bin/continuum"
  export REPO_DIR="$REPO_DIR"
  export LOG_DIR="$LOG_DIR"
  script -q "$LOG_DIR/terminal.log"
EOF
