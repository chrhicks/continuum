import { Schema } from 'effect'

export const MemorySummarySchema = Schema.Struct({
  narrative: Schema.String,
  decisions: Schema.Array(Schema.String),
  discoveries: Schema.Array(Schema.String),
  patterns: Schema.Array(Schema.String),
  whatWorked: Schema.Array(Schema.String),
  whatFailed: Schema.Array(Schema.String),
  blockers: Schema.Array(Schema.String),
  openQuestions: Schema.Array(Schema.String),
  nextSteps: Schema.Array(Schema.String),
  tasks: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  confidence: Schema.NullOr(Schema.Literal('low', 'medium', 'high')),
})
