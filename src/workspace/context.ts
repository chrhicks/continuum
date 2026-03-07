import type { WorkspaceContext } from './resolve'

let activeWorkspaceContext: WorkspaceContext | null = null

export function getActiveWorkspaceContext(): WorkspaceContext | null {
  return activeWorkspaceContext
}

export function setActiveWorkspaceContext(
  context: WorkspaceContext | null,
): WorkspaceContext | null {
  const previous = activeWorkspaceContext
  activeWorkspaceContext = context
  return previous
}

export function clearActiveWorkspaceContext(): void {
  activeWorkspaceContext = null
}
