/** Literal CSV fields; identifiers are never inferred as numbers. */
export type CsvRow = Record<string, string>

/** The five source tables required by the data operations. */
export interface DatasetInput {
  students: CsvRow[]
  items: CsvRow[]
  nodes: CsvRow[]
  requirements: CsvRow[]
  records: CsvRow[]
}

/** Explicit versions and origin used by every result from a prepared dataset. */
export interface PrepareOptions {
  source_mode?: 'live' | 'fixture'
  producer_version?: string
}

/** A human-review reason; no score correction is inferred from an issue. */
export interface QualityIssue {
  code: string
  message: string
}

/** Current or historical evidence with the unmodified imported fields. */
export interface EvidenceRecord {
  record_id: string
  event_id: string
  revision: number
  student_id: string
  item_id: string
  topic_id: string
  node_id: string
  submitted_at: string
  grading_status: string
  score: number | null
  max_score: number | null
  answer: string
  steps: string
  point_scores: string
  include_in_statistics: boolean
  quality_issues: QualityIssue[]
  action: 'include' | 'exclude' | 'review'
  original_values: CsvRow
  source: { file: string; row_number: number }
}

/** Immutable-by-convention snapshot; current records contain the highest revisions only. */
export interface PreparedDataset {
  schema_version: 'team-v1'
  dataset_version: string
  policy_version: 'team-policy-v1'
  producer_version: string
  source_mode: 'live' | 'fixture'
  input: DatasetInput
  history: EvidenceRecord[]
  current: EvidenceRecord[]
  summary: {
    raw_record_count: number
    unique_version_count: number
    current_event_count: number
    revised_event_count: number
    grading_status_counts: Record<string, number>
    included_count: number
    review_count: number
    excluded_count: number
  }
}

/** The node is mandatory so a request cannot silently combine different tests. */
export interface StudentScope {
  student_id: string
  node_id: string
}

/** Common team result metadata, including partial evidence and limitations. */
export interface ResultEnvelope<T> {
  schema_version: 'team-v1'
  dataset_version: string
  policy_version: 'team-policy-v1'
  producer_version: string
  source_mode: 'live' | 'fixture'
  scope: Record<string, string | boolean>
  result_status: 'ok' | 'insufficient_data' | 'needs_review' | 'error'
  payload: T
  evidence_ids: string[]
  limitations: string[]
}

/** Observed scores and coverage, without a claim about unobserved mastery. */
export interface ScoreSummary {
  record_count: number
  valid_record_count: number
  earned_score: number | null
  possible_score: number | null
  score_rate: number | null
  evidence_ids: string[]
}

/** Per-node individual statistics; absent topics and indicators remain explicit. */
export interface StudentStats extends ScoreSummary {
  student_id: string
  class_id: string
  node_id: string
  grading_status_counts: Record<string, number>
  topics: Array<ScoreSummary & { topic_id: string; taught: boolean }>
  indicators: Array<ScoreSummary & { indicator_id: string; topic_id: string }>
  review_record_ids: string[]
}

/** Filters are conjunctive; unrecognized identifiers fail instead of widening a query. */
export interface EvidenceQuery {
  record_ids?: string[]
  event_ids?: string[]
  student_id?: string
  node_id?: string
  include_history?: boolean
}

/** Records retain their imported answers and scoring-point text. */
export interface EvidencePayload {
  records: EvidenceRecord[]
}
