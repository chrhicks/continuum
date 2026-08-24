#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bash -n "$root/bin/run-once" "$root/bin/install-user"

mkdir -p "$tmp/home/bin"
printf '#!/bin/sh\nexit 0\n' > "$tmp/home/bin/systemctl"
chmod +x "$tmp/home/bin/systemctl"
HOME="$tmp/home" \
XDG_CONFIG_HOME="$tmp/config" \
XDG_DATA_HOME="$tmp/data" \
PATH="$tmp/home/bin:$PATH" \
  "$root/bin/install-user" >/dev/null
[[ $(stat -c '%a' "$tmp/config/linear-agent/continuum.env") == 600 ]]
[[ -x $tmp/home/.local/libexec/linear-agent/run-once ]]

mkdir -p "$tmp/run/bin" "$tmp/run/config/linear-agent"
git init -q "$tmp/run/repo"
git -C "$tmp/run/repo" config user.email test@example.com
git -C "$tmp/run/repo" config user.name Test
touch "$tmp/run/repo/README"
git -C "$tmp/run/repo" add README
git -C "$tmp/run/repo" commit -qm init
git -C "$tmp/run/repo" remote add origin https://example.invalid/repo.git
printf '#!/bin/sh\nexit 99\n' > "$tmp/run/bin/opencode"
chmod +x "$tmp/run/bin/opencode"
printf '# Test prompt\n' > "$tmp/run/prompt.md"
cat > "$tmp/run/config/linear-agent/test.env" <<EOF
LINEAR_AGENT_REPO=$tmp/run/repo
LINEAR_AGENT_PROMPT=$tmp/run/prompt.md
LINEAR_AGENT_OPENCODE_BIN=$tmp/run/bin/opencode
LINEAR_AGENT_AGENT=effect
LINEAR_AGENT_PROJECT=Test
LINEAR_AGENT_ASSIGNEE=me
LINEAR_AGENT_ROUTING_LABEL=agent:effect
LINEAR_AGENT_READY_STATUS=Todo
LINEAR_AGENT_CLAIMED_STATUS=InProgress
LINEAR_AGENT_IN_PROGRESS_STATUS=InProgress
LINEAR_AGENT_IN_REVIEW_STATUS=Review
LINEAR_AGENT_BLOCKED_STATUS=Backlog
LINEAR_AGENT_ALLOWED_BASES=master
LINEAR_AGENT_DRY_RUN=1
EOF
chmod 600 "$tmp/run/config/linear-agent/test.env"
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > "$tmp/dry-run.log"
grep -q 'dry run: would execute' "$tmp/dry-run.log"
[[ -z $(git -C "$tmp/run/repo" status --porcelain=v1) ]]

printf 'dirty\n' > "$tmp/run/repo/untracked"
set +e
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > /dev/null 2>&1
dirty_status=$?
set -e
[[ $dirty_status == 73 ]]

rm "$tmp/run/repo/untracked"
chmod 644 "$tmp/run/config/linear-agent/test.env"
set +e
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > /dev/null 2>&1
mode_status=$?
set -e
[[ $mode_status == 78 ]]

printf 'linear-agent smoke tests passed\n'
