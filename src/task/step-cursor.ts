import type { Step } from './types'

export function reconcile_current_step(
  steps: Step[],
  currentStep: number | null,
): number | null {
  const current =
    currentStep === null
      ? undefined
      : steps.find((step) => step.id === currentStep)

  if (current?.status === 'pending' || current?.status === 'in_progress') {
    return current.id
  }

  return steps.find((step) => step.status === 'pending')?.id ?? null
}
