import type { StudentStats } from '../data/types.ts'

/** A supplied learning resource, with its own identifier and source location. */
export interface CurriculumMaterial {
  material_id: string
  type: string
  title: string
  source_file: string | null
}

/** One observed curriculum indicator and its source-index locations. */
export interface CurriculumEntry {
  indicator_id: string
  topic_id: string
  topic_name: string
  objective: string
  indicator_description: string
  material_ids: string[]
  question_ids: string[]
  textbook_pages: string | null
  course_standard: {
    file: string
    file_page: number | null
    printed_page: number | null
    index_reference: string | null
    verification: 'input_index'
  }
  materials: CurriculumMaterial[]
}

/** A topic groups supplied indicators; links are teaching organization suggestions. */
export interface CurriculumTopic {
  topic_id: string
  name: string
  objective: string
  indicator_ids: string[]
  material_ids: string[]
}

/** Index entries and explicitly qualified relationships between learning topics. */
export interface CurriculumPayload {
  topics: CurriculumTopic[]
  entries: CurriculumEntry[]
  links: Array<{ from_topic_id: string; to_topic_id: string; relation: 'supports'; basis: string }>
}

/** A bounded observation, interpretation, missing observation, or scoring-review request. */
export interface Finding {
  finding_id: string
  category: 'fact' | 'inference' | 'insufficient_data' | 'scoring_review'
  finding_type: string
  title: string
  description: string
  topic_id: string | null
  indicator_id: string | null
  item_id: string | null
  evidence_ids: string[]
  step_refs: number[]
  point_refs: string[]
  material_ids: string[]
}

/** Node-specific statistics and evidence-bounded findings usable by the guidance module. */
export interface DiagnosisPayload {
  student_id: string
  node_id: string
  stats: StudentStats
  findings: Finding[]
  covered_indicator_ids: string[]
  unobserved_indicator_ids: string[]
  curriculum: CurriculumEntry[]
}
