import assert from 'node:assert/strict'
import test from 'node:test'
import { get_evidence, get_student_stats, prepare_dataset } from '../core.ts'
import { load_dataset } from '../io.ts'

const sourceDirectory = process.env.STUDY_DATA_DIR

test('the original competition snapshot satisfies the published team acceptance baseline', {
  skip: sourceDirectory ? false : 'Set STUDY_DATA_DIR to the private CSV directory to run live acceptance.',
}, async () => {
  assert.ok(sourceDirectory)
  const ds = prepare_dataset(await load_dataset(sourceDirectory), { source_mode: 'live' })
  assert.equal(ds.source_mode, 'live')
  assert.equal(ds.summary.raw_record_count, 806)
  assert.equal(ds.summary.current_event_count, 799)
  assert.equal(ds.summary.revised_event_count, 7)
  assert.deepEqual(ds.summary.grading_status_counts, { 已评分: 790, 待评分: 4, 未作答: 5 })

  // 差异化处置（2026-11-14 老师说明：系统检测并处理——纠正/忽略）。
  // 与 Python 参考实现（competition/src/study_companion）口径一致。
  const expectations: Array<[string, boolean, string?]> = [
    ['DR0081', true, 'topic'],      // 主题誊录错误 -> 以题库为准修正后计入
    ['DR0361', true, 'score'],      // 10>1 但评分点合计==满分 -> 纠正为 1 计入
    ['DR0535', true, 'score'],      // 4>3 且评分点合计 3==满分 -> 纠正为 3 计入
    ['DR0133', false],               // 评分点 2 != 满分 3，无自洽证据 -> 忽略
    ['DR0515', false],               // 节点范围外 -> 忽略（不迁移节点）
    ['DR0685', true],                // 答案与参考一致却 0 分 -> 保留原分计入，标复核
  ]
  for (const [id, included, kind] of expectations) {
    const row = ds.current.find(record => record.record_id === id)
    assert.ok(row, `Missing ${id}`)
    assert.ok(row.quality_issues.length > 0, `${id} must have a documented review reason`)
    assert.equal(row.include_in_statistics, included, `${id} 处置应为 include=${included}`)
    if (kind === 'topic') assert.equal(row.corrected?.topic_id, 'T01')
    if (kind === 'score') assert.ok(row.corrected?.score !== undefined && row.original_values['得分'] !== String(row.corrected.score))
  }
  assert.equal(ds.policy_version, 'team-policy-v2')
  assert.equal(ds.summary.stat_included_count, 788, '计入统计 = 790 已评分 - 2 忽略（与 Python 参考一致）')
  assert.equal(ds.summary.included_count, 787, 'action=include（DR0685 计入统计但标记 review）')

  const sparse = get_student_stats(ds, { student_id: 'D17', node_id: 'N01' })
  assert.equal(sparse.payload.record_count, 4)
  assert.equal(sparse.payload.earned_score, 8)
  assert.equal(sparse.payload.possible_score, 8)
  assert.equal(sparse.payload.topics.find(topic => topic.topic_id === 'T03')?.taught, false)
  const absent = get_student_stats(ds, { student_id: 'D17', node_id: 'N02' })
  assert.equal(absent.result_status, 'insufficient_data')
  assert.equal(absent.payload.record_count, 0)
  assert.equal(absent.payload.score_rate, null)

  const revised = get_evidence(ds, { event_ids: ['D22-N01-Q025'] }).payload.records[0]
  assert.ok(revised)
  assert.equal(revised.revision, 2)
  assert.equal(revised.score, 1)
  const diagnostic = get_evidence(ds, { record_ids: ['DR0023'] }).payload.records[0]
  assert.ok(diagnostic)
  assert.equal(diagnostic.student_id, 'D01')
  assert.equal(diagnostic.item_id, 'Q043')
  assert.equal(diagnostic.revision, 2)

  const strong = get_student_stats(ds, { student_id: 'D14', node_id: 'N02' })
  assert.equal(strong.payload.valid_record_count, 14)
  assert.equal(strong.payload.earned_score, 26)
  assert.equal(strong.payload.possible_score, 26)
})


test('differentiated policy numbers match the Python reference implementation', {
  skip: sourceDirectory && process.env.STUDY_DIFF_REFERENCE ? false : 'Set STUDY_DIFF_REFERENCE to the exported Python reference JSON.',
}, async () => {
  const reference: Record<string, { earned: number, possible: number, valid: number, excluded: number, pending: number, unanswered: number, no_record: number }>
    = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(process.env.STUDY_DIFF_REFERENCE!, 'utf8')))
  const ds = prepare_dataset(await load_dataset(sourceDirectory!), { source_mode: 'live' })
  const mismatches: string[] = []
  for (const [key, expected] of Object.entries(reference)) {
    const [studentId, nodeId] = key.split('@')
    if (!studentId || !nodeId) throw new Error(`bad key ${key}`)
    const stats = get_student_stats(ds, { student_id: studentId, node_id: nodeId })
    const actual = {
      earned: stats.payload.earned_score ?? 0,
      possible: stats.payload.possible_score ?? 0,
      valid: stats.payload.valid_record_count ?? 0,
    }
    if (actual.earned !== expected.earned || actual.possible !== expected.possible || actual.valid !== expected.valid) {
      mismatches.push(`${key}: TS ${JSON.stringify(actual)} != PY {earned:${expected.earned},possible:${expected.possible},valid:${expected.valid}}`)
    }
  }
  assert.deepEqual(mismatches, [], `跨语言对拍不一致:\n${mismatches.join('\n')}`)
})
