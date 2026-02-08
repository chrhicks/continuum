import continuum from 'continuum'
import type { ContinuumSDK, ListTasksResult } from '../src/sdk.d.ts'

const sdk: ContinuumSDK = continuum

const listResult: Promise<ListTasksResult> = sdk.task.list({ limit: 1 })

void listResult
