export type GuideOperation = {
  name: string
  use: string
}

export type ContinuumGuide = {
  version: 1
  purpose: string
  workflow: string[]
  operations: GuideOperation[]
  recordKinds: {
    conventional: string[]
    guidance: string
  }
}

const guide: ContinuumGuide = {
  version: 1,
  purpose:
    'Continuum preserves durable workspace knowledge so later agents can recover useful context.',
  workflow: [
    'Start with continuum_summary for recent workspace context.',
    'Search for concepts related to the current work before and during work to avoid repeating investigation.',
    'Record concise, self-contained observations, decisions, preferences, and lessons at useful checkpoints.',
    'Use lowercase tags that will help a later agent retrieve the record.',
    'When knowledge changes, record the current truth and reference the old record with supersedes.',
    'Browse chronologically when targeted search does not find enough context.',
    'Use continuum_memory_get to follow exact records and supersession history.',
  ],
  operations: [
    {
      name: 'continuum_summary',
      use: 'Read a mechanical briefing of the newest current records for one workspace.',
    },
    {
      name: 'continuum_memory_record',
      use: 'Store one complete immutable memory record, optionally superseding older records.',
    },
    {
      name: 'continuum_memory_search',
      use: 'Search relevant records or browse them chronologically with filters and pagination.',
    },
    {
      name: 'continuum_memory_get',
      use: 'Retrieve complete records by ID, including superseded history.',
    },
  ],
  recordKinds: {
    conventional: ['observation', 'decision', 'preference', 'lesson'],
    guidance:
      'These kinds are conventions, not an enum. Use another concise kind when it describes the memory better.',
  },
}

export function getGuide(): ContinuumGuide {
  return guide
}
