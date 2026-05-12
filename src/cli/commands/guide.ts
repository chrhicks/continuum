import { Command } from 'commander'

type GuideTopic = 'overview' | 'task' | 'memory' | 'recall' | 'summary'

const TOPICS: GuideTopic[] = ['overview', 'task', 'memory', 'recall', 'summary']

export function createGuideCommand(): Command {
  return new Command('guide')
    .description('Show an agent-oriented Continuum workflow guide')
    .argument('[topic]', 'overview, task, memory, recall, or summary')
    .action((topic?: string) => {
      console.log(renderGuide(topic))
    })
}

function renderGuide(topic?: string): string {
  const normalized = normalizeTopic(topic)
  if (normalized === 'task') return taskGuide
  if (normalized === 'memory') return memoryGuide
  if (normalized === 'recall') return recallGuide
  if (normalized === 'summary') return summaryGuide
  return overviewGuide
}

function normalizeTopic(topic?: string): GuideTopic {
  if (!topic) return 'overview'
  const normalized = topic.trim().toLowerCase()
  if (TOPICS.includes(normalized as GuideTopic)) {
    return normalized as GuideTopic
  }
  throw new Error(`Unknown guide topic '${topic}'. Use: ${TOPICS.join(', ')}.`)
}

const overviewGuide = `# Continuum Agent Guide

Use Continuum for durable task state and project memory.

Start of session:
1. continuum summary
2. continuum task list --status ready --sort priority --order asc
3. continuum task get <task_id> --expand parent,children,blockers

During work:
- Record findings: continuum task note add <task_id> --kind discovery --content @-
- Record decisions: continuum task note add <task_id> --kind decision --content @-
- Update steps: continuum task steps complete <task_id> --step-id <step_id> --notes @-
- Search memory: continuum memory search "<query>"

Before completion:
1. continuum task validate <task_id> --transition completed
2. continuum task complete <task_id> --outcome @-
3. continuum memory consolidate

Input conventions:
- Use @- for long stdin content.
- Use @path/to/file for file content.
- Priority is an integer; lower means more important.

More guides:
- continuum guide task
- continuum guide memory
- continuum guide recall
- continuum guide summary`

const taskGuide = `# Continuum Task Guide

Task statuses: open, ready, blocked, completed, cancelled, deleted
Task types: epic, feature, bug, investigation, chore
Step statuses: pending, in_progress, completed, skipped
Priority: lower number means higher priority

Find work:
- continuum task list --status ready --sort priority --order asc
- continuum task list --status open --sort priority --order asc
- continuum task get <task_id> --expand parent,children,blockers

Create work:
- continuum task create --title "..." --type feature --priority 100 --intent "..." --description @- --plan @-
- continuum task steps template
- continuum task steps add <task_id> --steps @-

Track work:
- continuum task steps list <task_id>
- continuum task steps update <task_id> <step_id> --status in_progress --notes @-
- continuum task steps complete <task_id> --step-id <step_id> --notes @-
- continuum task note add <task_id> --kind discovery --content @-
- continuum task note add <task_id> --kind decision --content @- --rationale @-

Finish work:
- continuum task validate <task_id> --transition completed
- continuum task complete <task_id> --outcome @-

Avoid:
- Do not delete tasks unless the user explicitly asks.
- Do not complete a task without an outcome.
- Do not ignore blockers; inspect them before changing blocked work.`

const memoryGuide = `# Continuum Memory Guide

Memory tiers:
- NOW: current or most recent session log
- RECENT: consolidated summaries from recent sessions
- MEMORY: long-term project knowledge

Start or inspect memory:
- continuum memory init
- continuum memory status
- continuum memory list

Search before making assumptions:
- continuum memory search "<query>"
- continuum memory search "<query>" --tier RECENT
- continuum memory search "<query>" --source recall

Record session context:
- continuum memory append agent "short progress note"
- continuum memory append tool <name> "short tool summary"

Consolidate when useful:
- continuum memory consolidate
- continuum memory consolidate --dry-run

Use summary first when joining an existing repo:
- continuum summary
- continuum summary --no-tasks
- continuum summary --memory-lines 20`

const recallGuide = `# Continuum Recall Guide

Recall imports OpenCode session summaries into Continuum memory search.

Inspect recall state:
- continuum memory recall search "<query>"
- continuum memory search "<query>" --source recall

Import summaries:
- continuum memory recall import
- continuum memory recall import --dry-run
- continuum memory collect --source opencode --summarize --import

Use recall when:
- The answer may be in older OpenCode sessions.
- RECENT and MEMORY do not contain enough context.
- You need prior decisions, investigations, or implementation history.`

const summaryGuide = `# Continuum Summary Guide

Use summary as the first command in an agent session.

Commands:
- continuum summary
- continuum summary --limit 10
- continuum summary --no-memory
- continuum summary --no-tasks
- continuum summary --memory-lines 20

Summary includes:
- task counts for active work
- highest-priority ready/open/blocked tasks
- recommended next task command
- current NOW memory excerpt
- RECENT memory excerpt

The output is deterministic and extractive. It does not call an LLM.`
