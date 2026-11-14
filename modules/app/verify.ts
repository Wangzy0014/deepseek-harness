import type { ResultEnvelope } from '../data/types.ts'
import type { WorkspacePayload } from './core.ts'

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
  const records = new Set(data.browser_snapshot.current.map(record => record.record_id))
  const materials = new Set(data.browser_snapshot.input.items.map(item => item['材料编号']))
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
      const record = data.browser_snapshot.current.find(candidate => candidate.record_id === id)
      if (!record || record.student_id !== student || record.node_id !== node) errors.push(`${label}: 证据${id}对象或节点不同`)
    }
  }
  check(data.curriculum, 'curriculum')
  for (const entry of data.curriculum.payload.entries) {
    for (const id of [...entry.material_ids, ...entry.question_ids]) if (!materials.has(id)) errors.push(`curriculum: 材料或题目${id}不存在`)
    for (const id of entry.question_ids) {
      const item = data.browser_snapshot.input.items.find(candidate => candidate['材料编号'] === id)
      if (item && (item['材料类型'] !== '题目' || item['指标编号'] !== entry.indicator_id || item['主题编号'] !== entry.topic_id)) errors.push(`curriculum: 题目${id}与指标主题不一致`)
    }
  }
  for (const [key, entry] of Object.entries(data.cases)) {
    const expected = { student_id: entry.statistics.payload.student_id, node_id: entry.statistics.payload.node_id }
    const scopeKey = `${entry.statistics.scope['student_id']}:${entry.statistics.scope['node_id']}`
    if (scopeKey !== key) errors.push(`${key}: 统计对象不一致`)
    for (const result of [entry.statistics, entry.diagnosis, entry.plan, entry.peers]) check(result, key, expected)
    for (const result of [entry.diagnosis.payload, entry.plan.payload]) {
      if (result.student_id !== expected.student_id || result.node_id !== expected.node_id) errors.push(`${key}: 结果内容对象不同`)
    }
    for (const finding of entry.diagnosis.payload.findings) {
      for (const id of finding.evidence_ids) if (!records.has(id)) errors.push(`${key}: 发现引用不存在的记录${id}`)
      ownEvidence(finding.evidence_ids, expected.student_id, expected.node_id, key)
      for (const id of finding.material_ids) if (!materials.has(id)) errors.push(`${key}: 发现引用不存在的材料${id}`)
    }
    for (const activity of entry.plan.payload.activities) {
      for (const id of [...activity.item_ids, ...activity.material_ids]) if (!materials.has(id)) errors.push(`${key}: 活动材料${id}不存在`)
      for (const id of activity.evidence_ids) {
        const record = data.browser_snapshot.current.find(candidate => candidate.record_id === id)
        if (!record?.include_in_statistics) errors.push(`${key}: 活动使用了无效评分记录${id}`)
      }
      ownEvidence(activity.evidence_ids, expected.student_id, expected.node_id, key)
      const node = data.browser_snapshot.input.nodes.find(candidate => candidate['节点编号'] === expected.node_id)
      const allowed = node?.['可用题目编号']?.split(/[、,，;；\s]+/u) ?? []
      for (const id of activity.item_ids) if (!allowed.includes(id)) errors.push(`${key}: 练习${id}超出当前节点`)
    }
    for (const hints of Object.values(entry.hints)) for (const hint of hints) {
      check(hint, key, expected)
      ownEvidence(hint.evidence_ids, expected.student_id, expected.node_id, key)
      if (hint.payload.mode !== 'student' || hint.payload.teacher_solution !== undefined) errors.push(`${key}: 学生提示包含教师答案字段`)
    }
  }
  for (const [key, report] of Object.entries(data.class_reports)) check(report, key, { class_id: report.payload.class_id, node_id: report.payload.node_id })
  return {
    status: errors.length ? 'failed' : 'passed',
    checks: ['各模块版本一致', '对象与测验节点一致', '作答证据与材料编号存在', '活动依据排除复核记录', '学生提示无教师答案字段'],
    errors: [...new Set(errors)], human_review: 'pending',
  }
}
