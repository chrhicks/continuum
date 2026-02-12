# Shardfall Scenarios (4)

Each scenario requires real code work in `chrhicks/shardfall`. Agents must use Continuum CLI
tasks throughout the run.

## SF-01 — Target Indicator Sticks After Block Break (Bug)

**Goal**: When a hovered block is destroyed, the target indicator should hide or retarget so it never remains on a dead block.

**Likely areas**:

- `src/scenes/DevScene.ts`
- `src/systems/MiningGrid.ts`
- `src/ui/TargetIndicator.ts`

**Repro**:

1. Hover a block so the target indicator is visible.
2. Mine the block until it breaks without moving the cursor.
3. Indicator stays on the empty spot.

**Acceptance criteria**:

- Indicator hides immediately after the hovered block is destroyed, even if the cursor does not move.
- No regressions to normal hover behavior.

**CLI requirements**:

- Task created with intent + description + plan.
- At least 2 steps.
- At least 1 discovery note.
- Validate transition before completion.

## SF-02 — Add “Sell All” to Inventory Panel (Feature)

**Goal**: Add a `SELL ALL` button inside the inventory panel and wire it to sell all ores.

**Likely areas**:

- `src/ui/InventoryPanel.ts`
- `src/scenes/DevScene.ts`
- `src/systems/InventorySystem.ts`

**Notes**:

- There is already a `sellAllOres()` API in `InventorySystem`.
- A separate `SELL ALL` button exists in `DevScene`; move or replace it so the panel owns the action.

**Acceptance criteria**:

- Inventory panel displays a `SELL ALL` button with disabled state when inventory is empty.
- Clicking `SELL ALL` sells all ores and updates gold/feedback.
- The old standalone button is removed or disabled to avoid duplicate pathways.

**CLI requirements**:

- Task created with intent + description + plan.
- At least 3 steps.
- At least 1 decision note.
- Validate transition before completion.

## SF-03 — Gold Formatting Abbreviations (Feature)

**Goal**: Replace scientific notation with abbreviated formats (K/M/B/T) for large gold values.

**Likely areas**:

- `src/ui/GoldDisplay.ts`

**Formatting rules**:

- `< 1,000` → raw integer (e.g., `950`)
- `>= 1,000` and `< 1,000,000` → `x.xxK` (e.g., `12.3K`)
- `>= 1,000,000` and `< 1,000,000,000` → `x.xxM`
- `>= 1,000,000,000` → `x.xxB` (use `T` for >= 1e12)
- Trim trailing zeros (e.g., `12.00K` → `12K`)

**Acceptance criteria**:

- Gold display and gain popups use the same format.
- Formatting is consistent for large values and updates correctly during animation.

**CLI requirements**:

- Task created with intent + description + plan.
- At least 2 steps.
- At least 1 discovery note.
- Validate transition before completion.

## SF-04 — Mining Damage vs HP Scaling (Investigation)

**Goal**: Determine whether mining damage and HP scaling remain balanced around depth 50–100 and propose adjustments.

**Likely areas**:

- `src/config/blocks.ts` (HP scaling, base HP)
- `src/objects/Block.ts` (HP behavior)
- `src/systems/StatSystem.ts` (damage stat)
- `src/scenes/DevScene.ts` (test controls)

**Deliverables**:

- A written analysis of time-to-clear or perceived difficulty around depth 50–100.
- A decision note recommending a change (or explicitly no change) with rationale.
- Optional code change if a clear improvement is identified.

**CLI requirements**:

- Task created with intent + description + plan.
- At least 2 steps.
- At least 1 decision note.
- Validate transition before completion.
