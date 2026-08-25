#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bash -n \
  "$root/bin/run-once" \
  "$root/bin/install-user" \
  "$root/bin/status" \
  "$root/bin/validate-continuum-worktree"
"$root/bin/status" --help >/dev/null
grep -q 'open PR plus ready status: this is requested-change work' "$root/prompts/scout.md"
grep -q 'do not repeat that dispatch' "$root/prompts/scout.md"
grep -q 'does not apply in PR review mode' "$root/prompts/reviewer.md"
grep -q 'repository audit mode only; not PR review mode' "$root/bin/run-once"
set +e
"$root/bin/validate-continuum-worktree" >/dev/null 2>&1
helper_status=$?
set -e
[[ $helper_status == 64 ]]

mkdir -p "$tmp/home/bin"
printf '#!/bin/sh\nexit 0\n' > "$tmp/home/bin/systemctl"
chmod +x "$tmp/home/bin/systemctl"
HOME="$tmp/home" \
XDG_CONFIG_HOME="$tmp/config" \
XDG_DATA_HOME="$tmp/data" \
PATH="$tmp/home/bin:$PATH" \
  "$root/bin/install-user" >/dev/null
[[ $(stat -c '%a' "$tmp/config/linear-agent/continuum-worker.env") == 600 ]]
[[ -x $tmp/home/.local/libexec/linear-agent/run-once ]]
[[ -x $tmp/home/.local/bin/linear-agent-status ]]
[[ -f $tmp/data/linear-agent/reviewer.md ]]
runner_inode=$(stat -c %i "$tmp/home/.local/libexec/linear-agent/run-once")
HOME="$tmp/home" \
XDG_CONFIG_HOME="$tmp/config" \
XDG_DATA_HOME="$tmp/data" \
PATH="$tmp/home/bin:$PATH" \
  "$root/bin/install-user" >/dev/null
[[ $(stat -c %i "$tmp/home/.local/libexec/linear-agent/run-once") != "$runner_inode" ]]
HOME="$tmp/home" \
XDG_CONFIG_HOME="$tmp/config" \
XDG_DATA_HOME="$tmp/data" \
PATH="$tmp/home/bin:$PATH" \
  "$root/bin/install-user" --profile=continuum-scout --role=scout >/dev/null
grep -q '^LINEAR_AGENT_ROLE=scout$' "$tmp/config/linear-agent/continuum-scout.env"
grep -q '^LINEAR_AGENT_MODEL=openai-codex/gpt-5.6-luna$' "$tmp/config/linear-agent/continuum-scout.env"

mkdir -p "$tmp/run/bin" "$tmp/run/config/linear-agent" "$tmp/run/config/mcp"
git init -q "$tmp/run/repo"
git -C "$tmp/run/repo" config user.email test@example.com
git -C "$tmp/run/repo" config user.name Test
touch "$tmp/run/repo/README"
git -C "$tmp/run/repo" add README
git -C "$tmp/run/repo" commit -qm init
git -C "$tmp/run/repo" remote add origin https://example.invalid/repo.git
cat > "$tmp/run/bin/pi" <<EOF
#!/bin/sh
printf '%s\\n' "\$@" > "$tmp/run/pi-args.log"
printf 'SCOUT_READY CHI-TEST\\nDISPATCH_WORKER\\n'
exit 0
EOF
cat > "$tmp/run/bin/systemctl" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$tmp/run/systemctl.log"
exit 0
EOF
chmod +x "$tmp/run/bin/pi" "$tmp/run/bin/systemctl"
printf '# Test prompt\n' > "$tmp/run/prompt.md"
printf '{"mcpServers":{}}\n' > "$tmp/run/config/mcp/mcp.json"
touch "$tmp/run/mcp-extension.ts"
cat > "$tmp/run/config/linear-agent/test.env" <<EOF
LINEAR_AGENT_ROLE=scout
LINEAR_AGENT_REPO=$tmp/run/repo
LINEAR_AGENT_PROMPT=$tmp/run/prompt.md
LINEAR_AGENT_PI_BIN=$tmp/run/bin/pi
LINEAR_AGENT_MCP_CONFIG=$tmp/run/config/mcp/mcp.json
LINEAR_AGENT_MCP_EXTENSION=$tmp/run/mcp-extension.ts
LINEAR_AGENT_AGENT=scout
LINEAR_AGENT_MODEL=openai-codex/gpt-5.6-luna
LINEAR_AGENT_THINKING=medium
LINEAR_AGENT_LOCK_GROUP=test
LINEAR_AGENT_PROJECT=Test
LINEAR_AGENT_GITHUB_REPO=example/test
LINEAR_AGENT_ASSIGNEE=me
LINEAR_AGENT_ROUTING_LABEL=agent:effect
LINEAR_AGENT_SCOUT_LABEL=scout-proposal
LINEAR_AGENT_STAGED_LABEL=integration:staged
LINEAR_AGENT_BACKLOG_STATUS=Backlog
LINEAR_AGENT_READY_STATUS=Todo
LINEAR_AGENT_CLAIMED_STATUS=InProgress
LINEAR_AGENT_IN_PROGRESS_STATUS=InProgress
LINEAR_AGENT_IN_REVIEW_STATUS=Review
LINEAR_AGENT_STAGED_STATUS=Review
LINEAR_AGENT_BLOCKED_STATUS=Backlog
LINEAR_AGENT_ACTIVE_STAGING=staging/test
LINEAR_AGENT_ALLOWED_BASES=staging/test
LINEAR_AGENT_DISPATCH_WORKER_PROFILE=test-worker
LINEAR_AGENT_DISPATCH_REVIEWER_PROFILE=test-reviewer
LINEAR_AGENT_DRY_RUN=1
EOF
chmod 600 "$tmp/run/config/linear-agent/test.env"
cp "$tmp/run/config/linear-agent/test.env" "$tmp/run/config/linear-agent/test-scout.env"
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
PATH="$tmp/run/bin:$PATH" \
  "$root/bin/status" test --local > "$tmp/status.log"
grep -q '^Linear agent status: test$' "$tmp/status.log"
grep -q "repo=$tmp/run/repo" "$tmp/status.log"
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > "$tmp/dry-run.log"
grep -q 'dry run: would execute' "$tmp/dry-run.log"
grep -q -- '--model openai-codex/gpt-5.6-luna' "$tmp/dry-run.log"
[[ -z $(git -C "$tmp/run/repo" status --porcelain=v1) ]]

sed -i 's/LINEAR_AGENT_DRY_RUN=1/LINEAR_AGENT_DRY_RUN=0/' "$tmp/run/config/linear-agent/test.env"
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
PATH="$tmp/run/bin:$PATH" \
  "$root/bin/run-once" test > "$tmp/live-run.log"
grep -q 'dispatching profile=test-worker' "$tmp/live-run.log"
grep -Fxq -- '--no-extensions' "$tmp/run/pi-args.log"
grep -Fxq -- '--extension' "$tmp/run/pi-args.log"
grep -Fxq -- "$tmp/run/mcp-extension.ts" "$tmp/run/pi-args.log"
grep -q -- '--user start --no-block linear-agent-worker@test-worker.service' "$tmp/run/systemctl.log"
sed -i 's/LINEAR_AGENT_DRY_RUN=0/LINEAR_AGENT_DRY_RUN=1/' "$tmp/run/config/linear-agent/test.env"

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
