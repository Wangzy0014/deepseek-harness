import type { ResultEnvelope } from '../data/types.ts'
import type { WorkspacePayload } from './core.ts'
import { scope_key } from '../shared/result.ts'

/** Machine-checkable consistency findings for one exported report. */
export interface VerificationResult {
  status: 'passed' | 'failed'
  checks: string[]
  errors: string[]
  human_review: 'pending'
}

/**
 * Check version, scope, evidence and material references without claiming teaching effectiveness.
 * @param workspace - Full local report built from one prepared source snapshot.
 * @returns Automated verification evidence; nonauthor human acceptance remains pending.
 */
export function verify_workspace(workspace: ResultEnvelope<WorkspacePayload>): VerificationResult {
  const errors: string[] = []
  const data = workspace.payload
  const records = new Map(data.browser_snapshot.current.map(record => [record.record_id, record]))
  const materials = new Map(data.browser_snapshot.input.items.map(item => [item['材料编号'], item]))
  const nodes = new Map(data.browser_snapshot.input.nodes.map(node => [node['节点编号']!, new Set(node['可用题目编号']?.split(/[、,，;；\s]+/u) ?? [])]))
  const students = new Set(data.browser_snapshot.input.students.map(student => student['学生编号']!))
  const classes = new Set(data.browser_snapshot.input.students.map(student => student['模拟班级编号']!))
  if (Object.keys(data.cases).length !== students.size * nodes.size) errors.push('学生案例数量与输入名单和节点数量不一致')
  if (Object.keys(data.class_reports).length !== classes.size * nodes.size) errors.push('班级报告数量与输入班级和节点数量不一致')
  for (const student of students) for (const node of nodes.keys()) if (!Object.hasOwn(data.cases, scope_key(student, node))) errors.push('学生节点案例缺失')
  for (const group of classes) for (const node of nodes.keys()) if (!Object.hasOwn(data.class_reports, scope_key(group, node))) errors.push('班级节点报告缺失')
  function check(result: ResultEnvelope<unknown>, label: string, expected: Record<string, string> = {}): void {
    for (const key of ['schema_version', 'dataset_version', 'policy_version', 'producer_version', 'source_mode'] as const) {
      if (result[key] !== workspace[key]) errors.push(`${label}: ${key}不同`)
    }
    if (result.result_status === 'error') errors.push(`${label}: 操作返回error`)
    for (const [key, value] of Object.entries(expected)) if (result.scope[key] !== value) errors.push(`${label}: ${key}对象范围不同`)
    for (const id of result.evidence_ids) if (!records.has(id)) errors.push(`${label}: 证据${id}不存在`)
  }
  function ownEvidence(ids: string[], student: string, node: string, label: string): void {
    for (const id of ids) {
      const record = records.get(id)
      if (!record || record.student_id !== student || record.node_id !== node) errors.push(`${label}: 证据${id}对象或节点不同`)
    }
  }
  check(data.curriculum, 'curriculum')
  for (const entry of data.curriculum.payload.entries) {
    for (const id of [...entry.material_ids, ...entry.question_ids]) if (!materials.has(id)) errors.push(`curriculum: 材料或题目${id}不存在`)
    for (const id of entry.question_ids) {
      const item = materials.get(id)
      if (item && (item['材料类型'] !== '题目' || item['指标编号'] !== entry.indicator_id || item['主题编号'] !== entry.topic_id)) errors.push(`curriculum: 题目${id}与指标主题不一致`)
    }
  }
  for (const [key, entry] of Object.entries(data.cases)) {
    const expected = { student_id: entry.statistics.payload.student_id, node_id: entry.statistics.payload.node_id }
    const scopeKey = scope_key(String(entry.statistics.scope['student_id']), String(entry.statistics.scope['node_id']))
    if (scopeKey !== key) errors.push(`${key}: 统计对象不一致`)
    if (!students.has(expected.student_id) || !nodes.has(expected.node_id)) errors.push(`${key}: 对象不在输入范围`)
    for (const result of [entry.statistics, entry.diagnosis, entry.plan, entry.peers]) check(result, key, expected)
    for (const result of [entry.diagnosis.payload, entry.plan.payload]) {
      if (result.student_id !== expected.student_id || result.node_id !== expected.node_id) errors.push(`${key}: 结果内容对象不同`)
    }
    const activityIds = new Set(entry.plan.payload.activities.map(activity => activity.activity_id))
    const delivery = entry.plan.payload.delivery
    const scheduled = [...delivery.first_activity_ids, ...delivery.follow_up_activity_ids]
    const findingIds = new Set(entry.diagnosis.payload.findings.map(finding => finding.finding_id))
    if (activityIds.size !== entry.plan.payload.activities.length || !Number.isInteger(delivery.first_batch_limit) || delivery.first_batch_limit < 1
      || delivery.first_activity_ids.length > delivery.first_batch_limit || new Set(scheduled).size !== scheduled.length
      || scheduled.length !== activityIds.size || scheduled.some(id => !activityIds.has(id))) errors.push(`${key}: 活动阶段安排不完整或超限`)
    for (const finding of entry.diagnosis.payload.findings) {
      for (const id of finding.evidence_ids) if (!records.has(id)) errors.push(`${key}: 发现引用不存在的记录${id}`)
      ownEvidence(finding.evidence_ids, expected.student_id, expected.node_id, key)
      for (const id of finding.material_ids) if (!materials.has(id)) errors.push(`${key}: 发现引用不存在的材料${id}`)
    }
    for (const activity of entry.plan.payload.activities) {
      const expectedPhase = delivery.first_activity_ids.includes(activity.activity_id) ? 'first' : 'follow_up'
      if (activity.phase !== expectedPhase) errors.push(`${key}: 活动阶段标记与安排不同`)
      if (activity.finding_ids.some(id => !findingIds.has(id))) errors.push(`${key}: 活动引用的诊断发现不存在`)
      for (const id of [...activity.item_ids, ...activity.material_ids]) if (!materials.has(id)) errors.push(`${key}: 活动材料${id}不存在`)
      for (const id of activity.evidence_ids) {
        const record = records.get(id)
        if (!record?.include_in_statistics) errors.push(`${key}: 活动使用了无效评分记录${id}`)
        if (record && (materials.get(record.item_id)?.['指标编号'] !== activity.indicator_id || record.topic_id !== activity.topic_id)) errors.push(`${key}: 活动证据${id}与指标主题不同`)
      }
      ownEvidence(activity.evidence_ids, expected.student_id, expected.node_id, key)
      const allowed = nodes.get(expected.node_id)
      for (const id of activity.item_ids) {
        if (!allowed?.has(id)) errors.push(`${key}: 练习${id}超出当前节点`)
        const item = materials.get(id)
        if (item && (item['指标编号'] !== activity.indicator_id || item['主题编号'] !== activity.topic_id)) errors.push(`${key}: 练习${id}与活动指标主题不同`)
      }
    }
    for (const [itemId, hints] of Object.entries(entry.hints)) for (const hint of hints) {
      check(hint, key, { ...expected, item_id: itemId })
      if (hint.payload.item_id !== itemId || hint.payload.student_id !== expected.student_id || hint.payload.node_id !== expected.node_id) errors.push(`${key}: 提示内容对象不同`)
      ownEvidence(hint.evidence_ids, expected.student_id, expected.node_id, key)
      if (hint.payload.mode !== 'student' || hint.payload.teacher_solution !== undefined) errors.push(`${key}: 学生提示包含教师答案字段`)
    }
  }
  for (const [key, report] of Object.entries(data.class_reports)) {
    if (key !== scope_key(report.payload.class_id, report.payload.node_id) || !classes.has(report.payload.class_id) || !nodes.has(report.payload.node_id)) errors.push(`${key}: 班级报告对象不同`)
    check(report, key, { class_id: report.payload.class_id, node_id: report.payload.node_id })
  }
  return {
    status: errors.length ? 'failed' : 'passed',
    checks: ['各模块版本一致', '对象与测验节点一致', '作答证据与材料编号存在', '活动依据排除复核记录', '学生提示无教师答案字段'],
    errors: [...new Set(errors)], human_review: 'pending',
  }
}
