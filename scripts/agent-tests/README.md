# Agent Test Scripts

This folder contains utilities for setting up Shardfall agent test runs.

## setup.sh

Creates an isolated run directory, clones the repo, and prints next steps.

```
./scripts/agent-tests/setup.sh SF-01 agent-A
```

Environment override:

```
AGENT_TEST_ROOT=/custom/path ./scripts/agent-tests/setup.sh SF-01 agent-A
```
