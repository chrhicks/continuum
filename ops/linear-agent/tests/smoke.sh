#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bash -n \
  "$root/bin/run-once" \
  "$root/bin/install-user" \
  "$root/bin/validate-continuum-worktree" \
  "$root/bin/verify-continuum-runtime"
set +e
"$root/bin/validate-continuum-worktree" >/dev/null 2>&1
helper_status=$?
set -e
[[ $helper_status == 64 ]]

validation_source=$tmp/validation-source
validation_runtime=$tmp/validation-runtime
validation_tmp=$tmp/validation-tmp
validation_trace=$tmp/validation-trace
validation_bun=$validation_runtime/configured-bun
mkdir -p "$validation_source/bin" "$validation_runtime" "$validation_tmp"
printf '{}\n' > "$validation_source/package.json"
cat > "$validation_source/bin/continuum" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
workspace=
command=
while [[ $# -gt 0 ]]; do
  case $1 in
    --cwd)
      workspace=$(realpath "$2")
      shift 2
      ;;
    --json)
      shift
      ;;
    *)
      command=$1
      shift
      ;;
  esac
done
entrypoint=$(realpath "$0")
case $command in
  runtime)
    database=$XDG_DATA_HOME/continuum/projects/test/continuum.db
    jq -cn \
      --arg workspace "$workspace" \
      --arg entrypoint "$entrypoint" \
      --arg data_home "$XDG_DATA_HOME" \
      --arg database "$database" \
      '{ok:true,data:{workspace:$workspace,entrypoint:$entrypoint,dataHome:$data_home,database:$database,storageGeneration:"xdg-project-sha256-v1"}}'
    ;;
  init)
    ;;
  verify-wrapper)
    isolated_root=${workspace%/workspace}
    [[ $entrypoint == "$VALIDATION_EXPECTED_ENTRYPOINT" ]]
    [[ $isolated_root == "$VALIDATION_EXPECTED_TMP_ROOT"/tmp.* ]]
    [[ $HOME == "$isolated_root/home" ]]
    [[ $XDG_DATA_HOME == "$isolated_root/xdg" ]]
    printf 'continuum_wrapper_verified\n' >> "$VALIDATION_TRACE"
    ;;
  *)
    exit 64
    ;;
esac
EOF
cat > "$validation_bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == run && ${2:-} == */bin/continuum ]]; then
  shift
  exec "$@"
fi
if [[ ${1:-} == run && ${2:-} == validate ]]; then
  resolved_bun=$(command -v bun)
  [[ $resolved_bun == "$VALIDATION_EXPECTED_TMP_ROOT"/tmp.*/bin/bun ]]
  bun nested-validation
  continuum verify-wrapper
  printf 'validate_script_verified\n' >> "$VALIDATION_TRACE"
  exit 0
fi
if [[ ${1:-} == nested-validation ]]; then
  [[ $(realpath "$0") == "$VALIDATION_EXPECTED_BUN" ]]
  printf 'nested_bun_verified\n' >> "$VALIDATION_TRACE"
  exit 0
fi
exit 64
EOF
chmod +x "$validation_source/bin/continuum" "$validation_bun"

set +e
PATH=/usr/bin \
CONTINUUM_VALIDATION_BUN_BIN=$validation_runtime/missing-bun \
  "$root/bin/validate-continuum-worktree" "$validation_source" >/dev/null 2>&1
missing_bun_status=$?
touch "$validation_runtime/non-executable-bun"
PATH=/usr/bin \
CONTINUUM_VALIDATION_BUN_BIN=$validation_runtime/non-executable-bun \
  "$root/bin/validate-continuum-worktree" "$validation_source" >/dev/null 2>&1
non_executable_bun_status=$?
set -e
[[ $missing_bun_status == 69 ]]
[[ $non_executable_bun_status == 69 ]]

PATH=/usr/bin \
TMPDIR=$validation_tmp \
VALIDATION_TRACE=$validation_trace \
VALIDATION_EXPECTED_BUN=$(realpath "$validation_bun") \
VALIDATION_EXPECTED_ENTRYPOINT=$(realpath "$validation_source/bin/continuum") \
VALIDATION_EXPECTED_TMP_ROOT=$(realpath "$validation_tmp") \
CONTINUUM_VALIDATION_BUN_BIN=$validation_bun \
  "$root/bin/validate-continuum-worktree" "$validation_source" >/dev/null
grep -qx 'nested_bun_verified' "$validation_trace"
grep -qx 'continuum_wrapper_verified' "$validation_trace"
grep -qx 'validate_script_verified' "$validation_trace"

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
[[ -f $tmp/data/linear-agent/reviewer.md ]]
HOME="$tmp/home" \
XDG_CONFIG_HOME="$tmp/config" \
XDG_DATA_HOME="$tmp/data" \
PATH="$tmp/home/bin:$PATH" \
  "$root/bin/install-user" --profile=continuum-scout --role=scout >/dev/null
grep -q '^LINEAR_AGENT_ROLE=scout$' "$tmp/config/linear-agent/continuum-scout.env"
grep -q '^LINEAR_AGENT_MODEL=openai-codex/gpt-5.6-luna$' "$tmp/config/linear-agent/continuum-scout.env"
grep -q '^LINEAR_AGENT_CONTINUUM_BIN=.*/continuum-control/bin/continuum$' \
  "$tmp/config/linear-agent/continuum-scout.env"

mkdir -p "$tmp/run/bin" "$tmp/run/config/linear-agent" "$tmp/run/config/mcp"
mkdir -p "$tmp/run/repo/bin" "$tmp/run/repo/ops/linear-agent/bin"
git init -q "$tmp/run/repo"
git -C "$tmp/run/repo" config user.email test@example.com
git -C "$tmp/run/repo" config user.name Test
touch "$tmp/run/repo/README"
cp "$root/bin/verify-continuum-runtime" \
  "$tmp/run/repo/ops/linear-agent/bin/verify-continuum-runtime"
cat > "$tmp/run/repo/bin/continuum" <<'EOF'
#!/bin/sh
entrypoint=$(realpath "$0")
workspace=
data_home=${XDG_DATA_HOME:?}
home=${HOME:?}
while [ "$#" -gt 0 ]; do
  if [ "$1" = --cwd ]; then
    workspace=$(realpath "$2")
    shift 2
  else
    shift
  fi
done
database=$data_home/continuum/projects/test/continuum.db
if [ "${LINEAR_AGENT_TEST_DATABASE_MISMATCH:-0}" = 1 ]; then
  database=$home/legacy-continuum.db
fi
printf '{"ok":true,"data":{"storageGeneration":"xdg-project-sha256-v1","workspace":"%s","entrypoint":"%s","home":"%s","dataHome":"%s","database":"%s"}}\n' \
  "$workspace" "$entrypoint" "$home" "$data_home" "$database"
EOF
chmod +x "$tmp/run/repo/bin/continuum"
git -C "$tmp/run/repo" add README bin ops
git -C "$tmp/run/repo" commit -qm init
git -C "$tmp/run/repo" remote add origin https://example.invalid/repo.git
cat > "$tmp/run/bin/pi" <<'EOF'
#!/bin/sh
printf 'SCOUT_READY CHI-TEST\nDISPATCH_WORKER\n'
exit 0
EOF
cat > "$tmp/run/bin/bun" <<'EOF'
#!/bin/sh
[ "$1" = run ] && shift
exec "$@"
EOF
cat > "$tmp/run/bin/executor" <<'EOF'
#!/bin/sh
if [ "$3" = mcp ] && [ "$4" = getServer ]; then
  command=$LINEAR_AGENT_BUN_BIN
  if [ "${LINEAR_AGENT_TEST_EXECUTOR_MISMATCH:-0}" = 1 ]; then
    command=$LINEAR_AGENT_PI_BIN
  fi
  jq -n \
    --arg command "$command" \
    --arg cli "$LINEAR_AGENT_CONTINUUM_BIN" \
    --arg cwd "$LINEAR_AGENT_REPO" \
    --arg home "$LINEAR_AGENT_CONTINUUM_HOME" \
    --arg data "$LINEAR_AGENT_CONTINUUM_DATA_HOME" \
    '{ok:true,data:{integration:{config:{command:$command,args:["run",$cli,"mcp"],cwd:$cwd,env:{HOME:$home,XDG_DATA_HOME:$data}}}}}'
elif [ "$3" = coreTools ] && [ "$4" = connections ] && [ "$5" = list ]; then
  jq -n --arg address "$LINEAR_AGENT_CONTINUUM_CONNECTION" \
    '{ok:true,data:{connections:[{address:$address,template:"none"}]}}'
elif [ "$2" = tools ] && [ "$6" = continuum_runtime ]; then
  database=$LINEAR_AGENT_CONTINUUM_DATA_HOME/continuum/projects/test/continuum.db
  if [ "${LINEAR_AGENT_TEST_TYPED_RUNTIME_MISMATCH:-0}" = 1 ]; then
    database=$LINEAR_AGENT_CONTINUUM_HOME/typed-legacy-continuum.db
  fi
  jq -n \
    --arg workspace "$LINEAR_AGENT_REPO" \
    --arg entrypoint "$LINEAR_AGENT_CONTINUUM_BIN" \
    --arg home "$LINEAR_AGENT_CONTINUUM_HOME" \
    --arg data "$LINEAR_AGENT_CONTINUUM_DATA_HOME" \
    --arg database "$database" \
    '{ok:true,data:{structuredContent:{storageGeneration:"xdg-project-sha256-v1",workspace:$workspace,entrypoint:$entrypoint,home:$home,dataHome:$data,database:$database}}}'
else
  exit 64
fi
EOF
cat > "$tmp/run/bin/systemctl" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$tmp/run/systemctl.log"
exit 0
EOF
chmod +x "$tmp/run/bin/pi" "$tmp/run/bin/bun" \
  "$tmp/run/bin/executor" "$tmp/run/bin/systemctl"
printf '# Test prompt\n' > "$tmp/run/prompt.md"
printf '{"mcpServers":{"executor":{"command":"%s","args":["mcp"]}}}\n' \
  "$tmp/run/bin/executor" > "$tmp/run/config/mcp/mcp.json"
cat > "$tmp/run/config/linear-agent/test.env" <<EOF
LINEAR_AGENT_ROLE=scout
LINEAR_AGENT_REPO=$tmp/run/repo
LINEAR_AGENT_PROMPT=$tmp/run/prompt.md
LINEAR_AGENT_PI_BIN=$tmp/run/bin/pi
LINEAR_AGENT_MCP_CONFIG=$tmp/run/config/mcp/mcp.json
LINEAR_AGENT_BUN_BIN=$tmp/run/bin/bun
LINEAR_AGENT_CONTINUUM_BIN=$tmp/run/repo/bin/continuum
LINEAR_AGENT_CONTINUUM_HOME=$tmp/run
LINEAR_AGENT_CONTINUUM_DATA_HOME=$tmp/run/data
LINEAR_AGENT_EXECUTOR_BIN=$tmp/run/bin/executor
LINEAR_AGENT_CONTINUUM_INTEGRATION=continuum
LINEAR_AGENT_CONTINUUM_CONNECTION=tools.continuum.org.default
LINEAR_AGENT_AGENT=scout
LINEAR_AGENT_MODEL=openai-codex/gpt-5.6-luna
LINEAR_AGENT_THINKING=medium
LINEAR_AGENT_LOCK_GROUP=test
LINEAR_AGENT_PROJECT=Test
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
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > "$tmp/dry-run.log"
grep -q 'continuum_runtime workspace=' "$tmp/dry-run.log"
grep -q 'database=.*/continuum/projects/test/continuum.db' "$tmp/dry-run.log"
grep -q 'dry run: would execute' "$tmp/dry-run.log"
grep -q -- '--model openai-codex/gpt-5.6-luna' "$tmp/dry-run.log"
[[ -z $(git -C "$tmp/run/repo" status --porcelain=v1) ]]

set +e
LINEAR_AGENT_TEST_EXECUTOR_MISMATCH=1 \
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > "$tmp/runtime-mismatch.log" 2>&1
runtime_mismatch_status=$?
set -e
[[ $runtime_mismatch_status == 78 ]]
grep -q 'Executor Continuum runtime mismatch' "$tmp/runtime-mismatch.log"

set +e
LINEAR_AGENT_TEST_TYPED_RUNTIME_MISMATCH=1 \
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > "$tmp/typed-runtime-mismatch.log" 2>&1
typed_runtime_mismatch_status=$?
set -e
[[ $typed_runtime_mismatch_status == 78 ]]
grep -q 'Executor typed Continuum runtime mismatch' \
  "$tmp/typed-runtime-mismatch.log"
grep -q 'typed-legacy-continuum.db' "$tmp/typed-runtime-mismatch.log"

set +e
LINEAR_AGENT_TEST_DATABASE_MISMATCH=1 \
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
  "$root/bin/run-once" test > "$tmp/database-mismatch.log" 2>&1
database_mismatch_status=$?
set -e
[[ $database_mismatch_status == 78 ]]
grep -q 'Continuum runtime diagnostic mismatch' "$tmp/database-mismatch.log"
grep -q 'legacy-continuum.db' "$tmp/database-mismatch.log"

sed -i 's/LINEAR_AGENT_DRY_RUN=1/LINEAR_AGENT_DRY_RUN=0/' "$tmp/run/config/linear-agent/test.env"
HOME="$tmp/run" \
XDG_CONFIG_HOME="$tmp/run/config" \
XDG_STATE_HOME="$tmp/run/state" \
PATH="$tmp/run/bin:$PATH" \
  "$root/bin/run-once" test > "$tmp/live-run.log"
grep -q 'dispatching profile=test-worker' "$tmp/live-run.log"
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
