import { ContinuumError } from './error'
import type { CollectionPatch } from './types'

function normalize_id(id: number | string, label: string): number {
  const value = typeof id === 'string' ? Number(id) : id
  if (!Number.isFinite(value)) {
    throw new ContinuumError('ITEM_NOT_FOUND', `${label} ${id} not found`)
  }
  return value
}

export function patch_collection<
  TItem extends { id: number },
  TAdd,
  TUpdate extends { id: number | string },
>(
  items: TItem[],
  patch: CollectionPatch<TAdd, TUpdate> | undefined,
  options: {
    label: string
    apply_update: (current: TItem, update: TUpdate) => TItem
    apply_add: (item: TAdd, index: number, nextId: number) => TItem
  },
): { items: TItem[]; deleted_ids: Set<number> } {
  const next = [...items]
  const deleted_ids = new Set<number>()

  if (!patch) {
    return { items: next, deleted_ids }
  }

  if (patch.delete && patch.delete.length > 0) {
    const deleteIds = new Set(
      patch.delete.map((id) => normalize_id(id, options.label)),
    )
    for (const itemId of deleteIds) {
      const exists = next.some((item) => item.id === itemId)
      if (!exists) {
        throw new ContinuumError(
          'ITEM_NOT_FOUND',
          `${options.label} ${itemId} not found`,
        )
      }
    }
    const filtered = next.filter((item) => !deleteIds.has(item.id))
    next.length = 0
    next.push(...filtered)
    for (const deletedId of deleteIds) {
      deleted_ids.add(deletedId)
    }
  }

  if (patch.update && patch.update.length > 0) {
    for (const update of patch.update) {
      const itemId = normalize_id(update.id, options.label)
      const index = next.findIndex((item) => item.id === itemId)
      if (index === -1) {
        throw new ContinuumError(
          'ITEM_NOT_FOUND',
          `${options.label} ${itemId} not found`,
        )
      }
      const current = next[index]!
      next[index] = options.apply_update(current, update)
    }
  }

  if (patch.add && patch.add.length > 0) {
    const maxId = next.reduce((max, item) => Math.max(max, item.id), 0)
    const added = patch.add.map((item, index) =>
      options.apply_add(item, index, maxId),
    )
    next.push(...added)
  }

  return { items: next, deleted_ids }
}
