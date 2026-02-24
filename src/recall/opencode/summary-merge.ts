import { type RecallSummaryResult } from './summary-schema'

export type RecallSummaryItem = {
  summary: RecallSummaryResult
  estTokens: number
}

export type RecallSummaryMergeContext = {
  pass: number
  groupIndex: number
  groupCount: number
  mode: 'budgeted' | 'pair-fallback'
}

export type RecallSummaryMergePassReport = {
  pass: number
  mode: 'budgeted' | 'pair-fallback'
  group_est_tokens: number[]
  group_sizes: number[]
  merge_max_tokens_used: Array<number | null>
}

export type RecallSummaryMergeReport = {
  passes: RecallSummaryMergePassReport[]
}

export type RecallSummaryMergeResult = {
  summary: RecallSummaryResult
  report: RecallSummaryMergeReport
}

export type RecallSummaryMergeHandlerResult = {
  summary: RecallSummaryResult
  maxTokensUsed?: number | null
}

export type RecallSummaryMergeHandler = (
  summaries: RecallSummaryResult[],
  context: RecallSummaryMergeContext,
) => Awaitable<RecallSummaryResult | RecallSummaryMergeHandlerResult>

type Awaitable<T> = T | Promise<T>

export function buildRecallSummaryItem(
  summary: RecallSummaryResult,
): RecallSummaryItem {
  return { summary, estTokens: estimateRecallSummaryTokens(summary) }
}

export function estimateRecallSummaryTokens(
  summary: RecallSummaryResult,
): number {
  return estimateTokens(JSON.stringify(summary))
}

export function groupSummaryItemsByTokenBudget(
  items: RecallSummaryItem[],
  maxTokens: number,
): RecallSummaryItem[][] {
  const state = items.reduce(
    (acc, item) => {
      const nextTokens = acc.currentTokens + item.estTokens
      if (acc.current.length > 0 && nextTokens >= maxTokens) {
        return {
          groups: [...acc.groups, acc.current],
          current: [item],
          currentTokens: item.estTokens,
        }
      }
      return {
        groups: acc.groups,
        current: [...acc.current, item],
        currentTokens: nextTokens,
      }
    },
    {
      groups: [] as RecallSummaryItem[][],
      current: [] as RecallSummaryItem[],
      currentTokens: 0,
    },
  )

  return [...state.groups, state.current].filter((group) => group.length > 0)
}

export function pairSummaryGroups(
  items: RecallSummaryItem[],
): RecallSummaryItem[][] {
  return items.reduce<RecallSummaryItem[][]>((groups, item, index) => {
    if (index % 2 === 0) {
      return [...groups, [item]]
    }
    const lastGroup = groups[groups.length - 1] ?? []
    return [...groups.slice(0, -1), [...lastGroup, item]]
  }, [])
}

export function sumGroupTokens(group: RecallSummaryItem[]): number {
  return group.reduce((total, item) => total + item.estTokens, 0)
}

export async function mergeRecallSummaryItems(
  items: RecallSummaryItem[],
  options: { maxTokens: number },
  merge: RecallSummaryMergeHandler,
): Promise<RecallSummaryMergeResult> {
  if (items.length === 0) {
    throw new Error('No summary items provided for merge.')
  }
  const maxTokens = normalizeLimit(options.maxTokens, 'maxTokens')

  let pass = 1
  let current = items
  const passes: RecallSummaryMergePassReport[] = []

  while (current.length > 1) {
    const grouped = groupSummaryItemsByTokenBudget(current, maxTokens)
    const needsPairFallback =
      grouped.length === current.length &&
      grouped.every((group) => group.length === 1)
    const mode: RecallSummaryMergePassReport['mode'] = needsPairFallback
      ? 'pair-fallback'
      : 'budgeted'
    const groups = needsPairFallback ? pairSummaryGroups(current) : grouped
    const groupTokens = groups.map((group) => sumGroupTokens(group))
    const groupSizes = groups.map((group) => group.length)

    const merged = await Promise.all(
      groups.map(async (group, index) => {
        if (group.length === 1) {
          return { item: group[0], maxTokensUsed: null }
        }
        const context: RecallSummaryMergeContext = {
          pass,
          groupIndex: index + 1,
          groupCount: groups.length,
          mode,
        }
        const result = await merge(
          group.map((item) => item.summary),
          context,
        )
        const normalized = normalizeMergeResult(result)
        return {
          item: buildRecallSummaryItem(normalized.summary),
          maxTokensUsed: normalized.maxTokensUsed,
        }
      }),
    )

    passes.push({
      pass,
      mode,
      group_est_tokens: groupTokens,
      group_sizes: groupSizes,
      merge_max_tokens_used: merged.map((result) => result.maxTokensUsed),
    })

    current = merged.map((result) => result.item)
    pass += 1
  }

  return {
    summary: current[0].summary,
    report: { passes },
  }
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function normalizeMergeResult(
  value: RecallSummaryResult | RecallSummaryMergeHandlerResult,
): { summary: RecallSummaryResult; maxTokensUsed: number | null } {
  if (value && typeof value === 'object' && 'summary' in value) {
    const result = value as RecallSummaryMergeHandlerResult
    return {
      summary: result.summary,
      maxTokensUsed: result.maxTokensUsed ?? null,
    }
  }
  return { summary: value as RecallSummaryResult, maxTokensUsed: null }
}

function normalizeLimit(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Summary merge ${label} must be a positive number.`)
  }
  return Math.floor(value)
}
