/** Deterministic current-record selection, conservative score checks, and evidence queries. */
import { createHash } from 'node:crypto'
import type {
  CsvRow, DatasetInput, EvidencePayload, EvidenceQuery, EvidenceRecord, PreparedDataset,
  PrepareOptions, QualityIssue, ResultEnvelope, ScoreSummary, StudentScope, StudentStats,
} from './types.ts'

class DatasetInputError extends Error {
  readonly code: 'invalid_input' | 'input_conflict'

  constructor(code: 'invalid_input' | 'input_conflict', message: string) {
    super(message)
    this.name = 'DatasetInputError'
    this.code = code
  }
}

function canonical(row: CsvRow): string {
  return JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => compareText(a, b))))
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function required(row: CsvRow, field: string, context: string): string {
  const value = row[field]
  if (value === undefined || value.trim() === '') throw new DatasetInputError('invalid_input', `${context}缺少${field}。`)
  return value
}

function uniqueRows(rows: CsvRow[]): CsvRow[] {
  return [...new Set(rows.map(canonical))].sort().map(text => JSON.parse(text) as CsvRow)
}

function keyedRows(rows: CsvRow[], field: string, context: string): Map<string, CsvRow> {
  const indexed = new Map<string, CsvRow>()
  for (const row of rows) {
    const id = required(row, field, context)
    const previous = indexed.get(id)
    if (previous && canonical(previous) !== canonical(row)) {
      throw new DatasetInputError('input_conflict', `${context}的${field}=${id}有内容冲突。`)
    }
    indexed.set(id, row)
  }
  return indexed
}

function ids(text: string | undefined): string[] {
  return text?.split(/[、,，;；\s]+/u).filter(Boolean) ?? []
}

function numeric(text: string | undefined): number | null {
  const decimal = text?.trim()
  if (!decimal || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(decimal)) return null
  const value = Number(decimal)
  return Number.isFinite(value) ? value : null
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

function normalizeAnswer(text: string): string {
  return text.normalize('NFKC').replace(/\s/gu, '').replace(/[−﹣]/gu, '-')
}

function pointMaximums(text: string): Map<string, number> | null {
  const maximums = new Map<string, number>()
  for (const line of text.split(/\r?\n/u).filter(line => line.trim())) {
    const match = /^(\S+)\s+.+?\s+(\d+(?:\.\d+)?)\s*分\s*$/u.exec(line.trim())
    if (!match?.[1] || !match[2] || maximums.has(match[1])) return null
    const maximum = numeric(match[2])
    if (maximum === null) return null
    maximums.set(match[1], maximum)
  }
  return maximums.size > 0 ? maximums : null
}

function checkPoints(record: EvidenceRecord, item: CsvRow, issues: QualityIssue[]): void {
  const maximums = pointMaximums(item['评分点'] ?? '')
  if (!maximums) {
    issues.push({ code: 'invalid_rubric', message: '题目评分点缺失或无法按“编号 说明 分值分”读取。' })
    return
  }
  const values = new Map<string, number>()
  let malformed = false
  for (const part of record.point_scores.split(/[；;\n]/u).filter(part => part.trim())) {
    const match = /^([^\s=]+)\s*=\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/u.exec(part.trim())
    if (!match?.[1] || !match[2] || values.has(match[1])) {
      malformed = true
      continue
    }
    const value = numeric(match[2])
    if (value === null) {
      malformed = true
      continue
    }
    const maximum = maximums.get(match[1])
    if (maximum === undefined || value < 0 || value > maximum) malformed = true
    values.set(match[1], value)
  }
  if (malformed || values.size !== maximums.size || [...maximums.keys()].some(id => !values.has(id))) {
    issues.push({ code: 'invalid_point_scores', message: '评分点缺失、重复、超限或与题目评分点不匹配。' })
  }
  const total = [...values.values()].reduce((sum, value) => sum + value, 0)
  if (record.score !== null && !near(total, record.score)) {
    issues.push({ code: 'point_total_mismatch', message: '分点评分之和与记录总分不一致。' })
  }
  const maximumTotal = [...maximums.values()].reduce((sum, value) => sum + value, 0)
  const itemMaximum = numeric(item['满分'])
  if (itemMaximum !== null && !near(maximumTotal, itemMaximum)) {
    issues.push({ code: 'rubric_maximum_mismatch', message: '题目评分点满分之和与题目满分不一致。' })
  }
}

function evaluateRecord(
  row: CsvRow, rowNumber: number, students: Map<string, CsvRow>, items: Map<string, CsvRow>,
  nodes: Map<string, CsvRow>, indicators: Map<string, CsvRow>,
): EvidenceRecord {
  const revisionText = required(row, '修订版本', '作答记录')
  const revision = Number(revisionText)
  if (!/^[1-9]\d*$/u.test(revisionText) || !Number.isSafeInteger(revision)) {
    throw new DatasetInputError('invalid_input', `修订版本必须是不带符号、小数点或进制前缀的十进制正整数：${revisionText}。`)
  }
  const record: EvidenceRecord = {
    record_id: required(row, '记录编号', '作答记录'),
    event_id: required(row, '作答事件编号', '作答记录'),
    revision,
    student_id: row['学生编号'] ?? '',
    item_id: row['材料编号'] ?? '',
    topic_id: row['主题编号'] ?? '',
    node_id: row['节点编号'] ?? '',
    submitted_at: row['模拟提交时间'] ?? '',
    grading_status: row['评分状态']?.trim() ?? '',
    score: numeric(row['得分']),
    max_score: numeric(row['满分']),
    answer: row['学生最终作答'] ?? '',
    steps: row['解答过程'] ?? '',
    point_scores: row['评分点得分'] ?? '',
    include_in_statistics: false,
    quality_issues: [],
    action: 'exclude',
    original_values: { ...row },
    source: { file: '作答记录.csv', row_number: rowNumber },
  }
  const issues = record.quality_issues
  const item = items.get(record.item_id)
  const node = nodes.get(record.node_id)
  if (!students.has(record.student_id)) issues.push({ code: 'unknown_student', message: '学生编号不在输入学生表中。' })
  if (!item || item['材料类型'] !== '题目') issues.push({ code: 'unknown_item', message: '材料编号不对应输入中的题目。' })
  if (!node) issues.push({ code: 'unknown_node', message: '节点编号不在输入测验节点表中。' })
  if (item && record.topic_id !== item['主题编号']) {
    issues.push({ code: 'topic_mismatch', message: '作答记录主题与题目主题不一致，未自动改写。' })
  }
  const indicator = item ? indicators.get(item['指标编号'] ?? '') : undefined
  if (item && !indicator) {
    issues.push({ code: 'unknown_indicator', message: '题目指标不在课程要求表中。' })
  }
  if (item && indicator && indicator['主题编号'] !== item['主题编号']) {
    issues.push({ code: 'indicator_topic_mismatch', message: '题目主题与其课程指标所属主题不一致，未自动改写。' })
  }
  if (node && !ids(node['可用题目编号']).includes(record.item_id)) {
    issues.push({ code: 'node_item_mismatch', message: '题目不在该测验节点允许的题目集合中，未依据日期改节点。' })
  }
  if (record.max_score === null || record.max_score <= 0) {
    issues.push({ code: 'invalid_maximum', message: '记录满分缺失、不是有限十进制数或非正数。' })
  }
  if (item && (numeric(item['满分']) === null || record.max_score !== numeric(item['满分']))) {
    issues.push({ code: 'maximum_mismatch', message: '记录满分与题目满分不一致。' })
  }
  if (!['已评分', '待评分', '未作答'].includes(record.grading_status)) {
    issues.push({ code: 'unknown_grading_status', message: '评分状态不属于已评分、待评分、未作答。' })
  }
  if (record.grading_status === '已评分') {
    if (record.score === null) issues.push({ code: 'missing_score', message: '已评分记录的得分缺失或不是有限十进制数。' })
    if (record.score !== null && (record.score < 0 || (record.max_score !== null && record.score > record.max_score))) {
      issues.push({ code: 'score_out_of_range', message: '记录得分小于零或超过满分。' })
    }
    if (item) {
      checkPoints(record, item, issues)
      const referenceAnswer = normalizeAnswer(item['参考答案'] ?? '')
      if (record.score === 0 && referenceAnswer !== '' && normalizeAnswer(record.answer) === referenceAnswer) {
        issues.push({ code: 'answer_score_conflict', message: '最终答案与参考答案规范化后相同但记零分，需人工复核，未自动改分。' })
      }
    }
  } else if ((row['得分']?.trim() ?? '') !== '' || record.point_scores.trim() !== '') {
    issues.push({ code: 'ungraded_with_score', message: '非已评分记录仍含得分或分点评分，需核对评分状态。' })
  }
  if (record.grading_status === '未作答' && (record.answer.trim() !== '' || record.steps.trim() !== '')) {
    issues.push({ code: 'unanswered_with_response', message: '未作答状态仍含最终答案或解答过程，需核对评分状态。' })
  }
  record.include_in_statistics = record.grading_status === '已评分' && issues.length === 0
  record.action = issues.length > 0 ? 'review' : record.include_in_statistics ? 'include' : 'exclude'
  return record
}

function countStatuses(records: EvidenceRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of records) counts[record.grading_status] = (counts[record.grading_status] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareText(a, b)))
}

function recordOrder(a: EvidenceRecord, b: EvidenceRecord): number {
  return compareText(a.event_id, b.event_id) || a.revision - b.revision || compareText(a.record_id, b.record_id)
}

/**
 * Select the highest revision per event and quarantine inconsistent scores without repairing them.
 * @param input - Literal source tables; exact repeated rows are imported once.
 * @param options - Explicit source origin and implementation version.
 * @returns A snapshot retaining all distinct historical versions and the current view.
 * @throws If identifiers, revision order, or equally identified source rows are ambiguous.
 */
export function prepare_dataset(input: DatasetInput, options: PrepareOptions = {}): PreparedDataset {
  const tables: DatasetInput = {
    students: uniqueRows(input.students), items: uniqueRows(input.items), nodes: uniqueRows(input.nodes),
    requirements: uniqueRows(input.requirements), records: uniqueRows(input.records),
  }
  const students = keyedRows(tables.students, '学生编号', '模拟学生')
  const items = keyedRows(tables.items, '材料编号', '题目与材料')
  const nodes = keyedRows(tables.nodes, '节点编号', '测验节点')
  const indicators = keyedRows(tables.requirements, '指标编号', '课程要求')
  for (const student of students.values()) required(student, '模拟班级编号', '模拟学生')
  keyedRows(tables.records, '记录编号', '作答记录')
  const sourceRows = new Map<string, number>()
  input.records.forEach((row, index) => {
    const key = canonical(row)
    if (!sourceRows.has(key)) sourceRows.set(key, index + 2)
  })
  const history = tables.records.map(row => evaluateRecord(row, sourceRows.get(canonical(row))!, students, items, nodes, indicators)).sort(recordOrder)
  const events = new Map<string, Map<number, EvidenceRecord>>()
  for (const record of history) {
    let versions = events.get(record.event_id)
    if (!versions) {
      versions = new Map<number, EvidenceRecord>()
      events.set(record.event_id, versions)
    }
    if (versions.has(record.revision)) {
      throw new DatasetInputError('input_conflict', `事件${record.event_id}的版本${record.revision}有多个不同记录。`)
    }
    const first = versions.values().next().value
    if (first && (first.student_id !== record.student_id || first.node_id !== record.node_id || first.item_id !== record.item_id)) {
      throw new DatasetInputError('input_conflict', `事件${record.event_id}跨版本指向不同学生、节点或题目。`)
    }
    versions.set(record.revision, record)
  }
  const current = [...events.values()].map(versions => {
    const highest = Math.max(...versions.keys())
    return versions.get(highest)!
  }).sort(recordOrder)
  const datasetVersion = `sha256:${createHash('sha256').update(JSON.stringify(tables)).digest('hex')}`
  return {
    schema_version: 'team-v1', dataset_version: datasetVersion, policy_version: 'team-policy-v1',
    producer_version: options.producer_version ?? 'study-data@0.1.0', source_mode: options.source_mode ?? 'live',
    input: tables, history, current,
    summary: {
      raw_record_count: input.records.length, unique_version_count: history.length, current_event_count: current.length,
      revised_event_count: [...events.values()].filter(versions => versions.size > 1).length,
      grading_status_counts: countStatuses(current), included_count: current.filter(record => record.action === 'include').length,
      review_count: current.filter(record => record.action === 'review').length,
      excluded_count: current.filter(record => record.action === 'exclude').length,
    },
  }
}

function envelope<T>(
  dataset: PreparedDataset, scope: Record<string, string | boolean>, payload: T,
  status: ResultEnvelope<T>['result_status'], evidence: string[], limitations: string[],
): ResultEnvelope<T> {
  return {
    schema_version: dataset.schema_version, dataset_version: dataset.dataset_version, policy_version: dataset.policy_version,
    producer_version: dataset.producer_version, source_mode: dataset.source_mode, scope, result_status: status,
    payload, evidence_ids: [...new Set(evidence)].sort(), limitations,
  }
}

function summarize(records: EvidenceRecord[]): ScoreSummary {
  const valid = records.filter(record => record.include_in_statistics)
  const earned = valid.length > 0 ? valid.reduce((sum, record) => sum + record.score!, 0) : null
  const possible = valid.length > 0 ? valid.reduce((sum, record) => sum + record.max_score!, 0) : null
  return {
    record_count: records.length, valid_record_count: valid.length, earned_score: earned, possible_score: possible,
    score_rate: earned !== null && possible !== null && possible > 0 ? earned / possible : null,
    evidence_ids: valid.map(record => record.record_id).sort(),
  }
}

/**
 * Describe one student's observed scores and coverage in one explicitly selected test.
 * @param dataset - Prepared snapshot; flagged or ungraded records do not contribute scores.
 * @param scope - Student and node identifiers taken from the input tables.
 * @returns Score, topic, indicator, and review summaries; missing observations remain null.
 */
export function get_student_stats(dataset: PreparedDataset, scope: StudentScope): ResultEnvelope<StudentStats> {
  const student = dataset.input.students.find(row => row['学生编号'] === scope.student_id)
  const node = dataset.input.nodes.find(row => row['节点编号'] === scope.node_id)
  const empty: StudentStats = {
    ...summarize([]), student_id: scope.student_id, class_id: student?.['模拟班级编号'] ?? '', node_id: scope.node_id,
    grading_status_counts: {}, topics: [], indicators: [], review_record_ids: [],
  }
  if (!student || !node) {
    return envelope(dataset, { ...scope }, empty, 'error', [], ['学生编号或节点编号不在输入名单中，未合并其他节点或扩大范围。'])
  }
  const records = dataset.current.filter(record => record.student_id === scope.student_id && record.node_id === scope.node_id)
  const items = new Map(dataset.input.items.map(row => [row['材料编号'], row]))
  const topicIds = [...new Set(dataset.input.requirements.map(row => row['主题编号'] ?? ''))].filter(Boolean).sort()
  const taught = new Set(ids(node['已教及测量主题']))
  const payload: StudentStats = {
    ...summarize(records), student_id: scope.student_id, class_id: student['模拟班级编号']!, node_id: scope.node_id,
    grading_status_counts: countStatuses(records),
    topics: topicIds.map(topicId => ({ ...summarize(records.filter(record => record.topic_id === topicId)), topic_id: topicId, taught: taught.has(topicId) })),
    indicators: dataset.input.requirements.map(requirement => {
      const indicatorId = requirement['指标编号']!
      return {
        ...summarize(records.filter(record => items.get(record.item_id)?.['指标编号'] === indicatorId)),
        indicator_id: indicatorId, topic_id: requirement['主题编号'] ?? '',
      }
    }).sort((a, b) => compareText(a.indicator_id, b.indicator_id)),
    review_record_ids: records.filter(record => record.action === 'review').map(record => record.record_id).sort(),
  }
  const limitations = ['统计仅描述该节点已有且通过质量检查的作答，缺少记录不等于答错或未掌握。', '主题覆盖不代表该主题全部知识均已测量，不直接比较不同节点的总分为学习进步。']
  if (payload.review_record_ids.length > 0) limitations.push('待复核记录已保留原值，并排除在得分统计之外。')
  if (records.length === 0) limitations.push('该学生在指定节点没有作答记录，需补充观察。')
  else if (payload.valid_record_count === 0) limitations.push('该节点没有可计分记录，不能形成得分结论。')
  const status = payload.review_record_ids.length > 0 ? 'needs_review' : payload.valid_record_count === 0 ? 'insufficient_data' : 'ok'
  return envelope(dataset, { ...scope }, payload, status, records.map(record => record.record_id), limitations)
}

/**
 * Retrieve unmodified answers and scoring evidence with conjunctive identifier filters.
 * @param dataset - Prepared snapshot with current and historical versions.
 * @param query - Optional record, event, student, and node filters; history is opt-in.
 * @returns Matching evidence, or an explicit error for any unknown supplied identifier.
 */
export function get_evidence(dataset: PreparedDataset, query: EvidenceQuery): ResultEnvelope<EvidencePayload> {
  const scope: Record<string, string | boolean> = { include_history: query.include_history ?? false }
  if (query.student_id !== undefined) scope['student_id'] = query.student_id
  if (query.node_id !== undefined) scope['node_id'] = query.node_id
  if (query.record_ids !== undefined) scope['record_ids'] = query.record_ids.join(',')
  if (query.event_ids !== undefined) scope['event_ids'] = query.event_ids.join(',')
  const knownRecords = new Set(dataset.history.map(record => record.record_id))
  const knownEvents = new Set(dataset.history.map(record => record.event_id))
  const invalid = (query.record_ids?.some(id => !knownRecords.has(id)) ?? false)
    || (query.event_ids?.some(id => !knownEvents.has(id)) ?? false)
    || (query.student_id !== undefined && !dataset.input.students.some(row => row['学生编号'] === query.student_id))
    || (query.node_id !== undefined && !dataset.input.nodes.some(row => row['节点编号'] === query.node_id))
  if (invalid) return envelope(dataset, scope, { records: [] }, 'error', [], ['查询包含未知编号，未忽略筛选条件或扩大查询。'])
  const source = query.include_history ? dataset.history : dataset.current
  const records = source.filter(record => (query.record_ids === undefined || query.record_ids.includes(record.record_id))
    && (query.event_ids === undefined || query.event_ids.includes(record.event_id))
    && (query.student_id === undefined || record.student_id === query.student_id)
    && (query.node_id === undefined || record.node_id === query.node_id))
  const review = records.some(record => record.action === 'review')
  const limitations: string[] = []
  if (query.include_history) limitations.push('包含历史修订版本，不得将所有返回行直接累加为独立作答。')
  if (review) limitations.push('包含待复核记录；原始得分与答案仅用于核对，不可直接形成能力结论。')
  if (records.length === 0) limitations.push('指定筛选条件下没有匹配的作答记录。')
  return envelope(dataset, scope, { records }, review ? 'needs_review' : records.length === 0 ? 'insufficient_data' : 'ok', records.map(record => record.record_id), limitations)
}
