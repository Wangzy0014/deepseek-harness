import type { StudentStats } from '../data/types.ts'

/** A grounded learning activity with an observable completion and adjustment condition. */
export interface LearningActivity {
  activity_id: string
  order: number
  kind: 'targeted_practice' | 'extension' | 'observation'
  phase: 'first' | 'follow_up'
  selection_reason: 'diagnosed_error' | 'partial_score' | 'unattempted_item' | 'explanation_check'
  finding_ids: string[]
  goal: string
  indicator_id: string
  topic_id: string
  item_ids: string[]
  material_ids: string[]
  evidence_ids: string[]
  rationale: string
  prompt: string
  observation: string
  adjust_when: string
}

/** An executable local-rule plan; missing observations never become a mastery claim. */
export interface LearningPlanPayload {
  engine: 'local_rules'
  student_id: string
  node_id: string
  plan_type: 'targeted_practice' | 'extension' | 'observation' | 'blocked'
  diagnosis_status: 'ok' | 'insufficient_data' | 'needs_review' | 'error'
  statistics: StudentStats
  activities: LearningActivity[]
  delivery: {
    first_activity_ids: string[]
    follow_up_activity_ids: string[]
    first_batch_limit: number
    advance_when: string
  }
  review_record_ids: string[]
}

/** A hint request has an explicit test and an explicit teacher or student presentation. */
export interface HintRequest {
  student_id: string
  node_id: string
  item_id: string
  level: 1 | 2 | 3
  mode?: 'student' | 'teacher'
}

/** Student hints omit imported answers, worked solutions and scoring rubrics. */
export interface HintPayload {
  engine: 'local_rules'
  mode: 'student' | 'teacher'
  student_id: string
  node_id: string
  item_id: string
  level: 1 | 2 | 3
  hint: string
  requires_review: boolean
  teacher_solution?: {
    reference_answer: string
    reference_analysis: string
    scoring_rubric: string
  }
}
