export { createContinuum, createContinuumImporter } from './continuum'
export type { Continuum, ContinuumImporter } from './continuum'
export { resolveContinuumDataPaths } from './database/database'
export type { ContinuumDataPaths, DataPathOptions } from './database/database'
export { ContinuumError, WorkspaceConflictError } from './errors'
export type { ContinuumErrorCode } from './errors'
export { getGuide } from './guide/guide'
export type { ContinuumGuide, GuideOperation } from './guide/guide'
export type {
  GetMemoryInput,
  GetMemoryResult,
  MemorySearchResult,
  SearchMemoryInput,
  WorkspaceSummaryInput,
  WorkspaceSummaryResult,
} from './memory/retrieval'
export type {
  ImportMemoryRecordInput,
  MemoryRecord,
  RecordMemoryInput,
} from './memory/records'
export type { WorkspaceAlias, WorkspaceInfo } from './workspaces/workspaces'
