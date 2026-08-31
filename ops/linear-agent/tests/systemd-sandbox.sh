#!/usr/bin/env bash
set -euo pipefail

require=0
if [[ ${1:-} == --require ]]; then
  require=1
elif [[ $# -ne 0 ]]; then
  printf 'usage: %s [--require]\n' "$0" >&2
  exit 64
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  if (( require )); then
    printf 'systemd user manager is unavailable\n' >&2
    exit 69
  fi
  printf 'systemd sandbox probe skipped: user manager unavailable\n'
  exit 0
fi

root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
mkdir -p "$root/.tmp"
probe=$(mktemp -d "$root/.tmp/linear-agent-systemd.XXXXXX")
trap 'rm -rf "$probe"' EXIT

profile_state=$probe/state/profile
shared_state=$probe/state/shared
control_repo=$probe/control
worktree_root=$probe/worktrees
continuum_store=$probe/data/continuum
protected_path=$probe/unrelated
mkdir -p \
  "$profile_state/runs" \
  "$shared_state" \
  "$control_repo" \
  "$worktree_root" \
  "$continuum_store" \
  "$protected_path"
git init -q "$control_repo"
git -C "$control_repo" config user.email sandbox@example.invalid
git -C "$control_repo" config user.name 'Sandbox Probe'
printf 'control\n' > "$control_repo/README"
git -C "$control_repo" add README
git -C "$control_repo" commit -qm initial

set +e
systemd-run --user --wait --collect --quiet \
  -p Type=exec \
  -p NoNewPrivileges=true \
  -p ProtectSystem=strict \
  -p ProtectHome=read-only \
  -p PrivateTmp=true \
  -- /usr/bin/touch "$profile_state/runs/without-grant" \
  >/dev/null 2>&1
baseline_status=$?
set -e
[[ $baseline_status -ne 0 ]]
[[ ! -e $profile_state/runs/without-grant ]]

# The single-quoted script intentionally reads the positional arguments below.
# shellcheck disable=SC2016
systemd-run --user --wait --collect --quiet \
  -p Type=exec \
  -p NoNewPrivileges=true \
  -p ProtectSystem=strict \
  -p ProtectHome=read-only \
  -p PrivateTmp=true \
  -p "ReadWritePaths=$profile_state" \
  -p "ReadWritePaths=$shared_state" \
  -p "ReadWritePaths=$control_repo" \
  -p "ReadWritePaths=$worktree_root" \
  -p "ReadWritePaths=$continuum_store" \
  -- /usr/bin/bash -c '
    set -e
    touch "$1/runs/run.log"
    touch "$2/agent.lock"
    touch "$3/.git/info/exclude"
    git -C "$3" worktree add -qb agent/sandbox-probe "$4/issue"
    printf "worker change\n" > "$4/issue/worker-change"
    git -C "$4/issue" add worker-change
    git -C "$4/issue" commit -qm "sandbox worker commit"
    touch "$5/continuum.db"
    ! touch "$6/denied" 2>/dev/null
  ' _ \
  "$profile_state" \
  "$shared_state" \
  "$control_repo" \
  "$worktree_root" \
  "$continuum_store" \
  "$protected_path"

[[ -f $profile_state/runs/run.log ]]
[[ -f $shared_state/agent.lock ]]
[[ -f $control_repo/.git/info/exclude ]]
[[ -f $worktree_root/issue/worker-change ]]
[[ $(git -C "$worktree_root/issue" log -1 --format=%s) == 'sandbox worker commit' ]]
[[ -f $continuum_store/continuum.db ]]
[[ ! -e $protected_path/denied ]]
printf 'linear-agent systemd sandbox probe passed\n'
