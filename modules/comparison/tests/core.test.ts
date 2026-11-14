import assert from 'node:assert/strict'
import test from 'node:test'
import { prepare_dataset } from '../../data/core.ts'
import { load_dataset } from '../../data/io.ts'
import type { CsvRow, DatasetInput } from '../../data/types.ts'
import { make_input, make_record } from '../../data/tests/helpers.ts'
import { analyze_class, compare_classes, compare_students, compare_with_peers } from '../core.ts'

function near(actual: number | null, expected: number): void {
  assert.notEqual(actual, null)
  assert.ok(Math.abs(actual! - expected) < 1e-12, `${actual} differs from ${expected}`)
}

function weightInput(): DatasetInput {
  const input = make_input([])
  input.students = Array.from({ length: 10 }, (_, index) => ({ 学生编号: `S${index + 1}`, 模拟班级编号: 'C1', 年级: '7' }))
  input.items = input.items.filter(row => row.材料编号 !== 'A2').map(row => ({
    ...row, 满分: row.材料编号 === 'A1' ? '1' : '3', 参考答案: 'ok',
    评分点: `${row.材料编号}P1 答案正确 ${row.材料编号 === 'A1' ? '1' : '3'}分`,
  }))
  const record = (student: string, item: string, score: string, maximum: string): CsvRow => make_record({
    记录编号: `${student}-${item}`, 作答事件编号: `${student}-M1-${item}`, 学生编号: student, 材料编号: item,
    得分: score, 满分: maximum, 学生最终作答: score === '0' ? 'wrong' : 'ok', 评分点得分: `${item}P1=${score}`,
  })
  input.records = [record('S1', 'A1', '1', '1'), record('S1', 'A3', '0', '3'),
    ...Array.from({ length: 9 }, (_, index) => record(`S${index + 2}`, 'A1', '0', '1')),
    record('S2', 'A3', '3', '3')]
  return input
}

test('same-item maximum weights are independent of peer exercise counts', () => {
  const input = weightInput()
  const dataset = prepare_dataset(input, { source_mode: 'fixture' })
  const response = compare_with_peers(dataset, { student_id: 'S1', node_id: 'M1' })
  assert.equal(response.result_status, 'ok')
  assert.equal(response.payload.comparable, true)
  assert.deepEqual(response.payload.shared_item_ids, ['A1', 'A3'])
  assert.deepEqual(response.payload.items.map(row => row.weight), [0.25, 0.75])
  near(response.payload.left_rate, 0.25)
  near(response.payload.right_rate, 0.75)
  near(response.payload.delta_rate, -0.5)
  near(response.payload.delta_percentage_points, -50)
  assert.equal(response.payload.items[0]?.right_count, 9)
  assert.equal(response.payload.items[1]?.right_count, 1)
  assert.equal(response.payload.exclude_self, true)
  const peers = dataset.current.filter(row => row.student_id !== 'S1')
  near(peers.reduce((sum, row) => sum + row.score!, 0) / peers.reduce((sum, row) => sum + row.max_score!, 0), 0.25)
  assert.equal(response.source_mode, 'fixture')
  assert.equal(response.dataset_version, dataset.dataset_version)
})

test('an item without a valid sample on either side is removed from both sides', () => {
  const input = weightInput()
  input.records = input.records.filter(row => !(row.学生编号 === 'S2' && row.材料编号 === 'A3'))
  const response = compare_with_peers(prepare_dataset(input), { student_id: 'S1', node_id: 'M1' })
  assert.deepEqual(response.payload.shared_item_ids, ['A1'])
  assert.deepEqual(response.payload.excluded_items, [{ item_id: 'A3', reason_codes: ['no_valid_right_sample'] }])
  near(response.payload.left_rate, 1)
  near(response.payload.right_rate, 0)
  assert.equal(response.payload.items[0]?.weight, 1)
  assert.ok(!response.evidence_ids.includes('S1-A3'))
})

test('two students and two classes use the same per-item calculation', () => {
  const input = weightInput()
  input.students = input.students.filter(row => ['S1', 'S2'].includes(row.学生编号!))
  input.students[1]!.模拟班级编号 = 'C2'
  input.records = input.records.filter(row => ['S1', 'S2'].includes(row.学生编号!))
  const dataset = prepare_dataset(input)
  const students = compare_students(dataset, { left_student_id: 'S1', right_student_id: 'S2', node_id: 'M1' })
  const classes = compare_classes(dataset, { left_class_id: 'C1', right_class_id: 'C2', node_id: 'M1' })
  near(students.payload.left_rate, 0.25)
  near(students.payload.right_rate, 0.75)
  assert.equal(classes.payload.left_rate, students.payload.left_rate)
  assert.equal(classes.payload.right_rate, students.payload.right_rate)
  assert.equal(classes.payload.delta_percentage_points, students.payload.delta_percentage_points)
})

test('peers exclude the requesting student before determining the common item set', () => {
  const dataset = prepare_dataset(make_input())
  const response = compare_with_peers(dataset, { student_id: 'S1', node_id: 'M1' })
  assert.equal(response.result_status, 'insufficient_data')
  assert.equal(response.payload.comparable, false)
  assert.equal(response.payload.left_rate, null)
  assert.equal(response.payload.right_rate, null)
  assert.equal(response.payload.delta_rate, null)
  assert.ok(response.payload.reason_codes.includes('no_shared_valid_items'))
  assert.deepEqual(response.evidence_ids, [])
})

test('score-conflict records follow the team disposition policy and stay traceable', () => {
  const input = weightInput()
  input.records.find(row => row.记录编号 === 'S2-A3')!.得分 = '99'
  // 差异化处置（默认，老师口径）：评分点合计==满分 -> 纠正为 3 进入统计，
  // 修正值参与共同题均值，原文与修正痕迹保留可追溯。
  const repaired = compare_with_peers(prepare_dataset(input), { student_id: 'S1', node_id: 'M1' })
  assert.equal(repaired.result_status, 'ok')
  assert.deepEqual(repaired.payload.shared_item_ids, ['A1', 'A3'])
  assert.ok(repaired.evidence_ids.includes('S2-A3'))
  // 保守模式（team-policy-v1）：全部隔离待复核，不进均值。
  const conservative = compare_with_peers(
    prepare_dataset(input, { policy: 'conservative' }), { student_id: 'S1', node_id: 'M1' })
  assert.equal(conservative.result_status, 'needs_review')
  assert.deepEqual(conservative.payload.quality_record_ids, ['S2-A3'])
  assert.deepEqual(conservative.payload.shared_item_ids, ['A1'])
  assert.ok(!conservative.evidence_ids.includes('S2-A3'))
})

test('comparisons isolate nodes and reject unknown or out-of-node identifiers', () => {
  const dataset = prepare_dataset(weightInput())
  const emptyNode = compare_students(prepare_dataset(make_input()), { left_student_id: 'S1', right_student_id: 'S2', node_id: 'M2' })
  assert.equal(emptyNode.result_status, 'insufficient_data')
  const badRequests = [
    compare_students(dataset, { left_student_id: 'missing', right_student_id: 'S2', node_id: 'M1' }),
    compare_students(dataset, { left_student_id: 'S1', right_student_id: 'S2', node_id: 'missing' }),
    compare_students(dataset, { left_student_id: 'S1', right_student_id: 'S2', node_id: 'M1', item_ids: ['missing'] }),
    compare_with_peers(dataset, { student_id: 'S1', node_id: 'M1', class_id: 'missing' }),
    compare_classes(dataset, { left_class_id: 'C1', right_class_id: 'missing', node_id: 'M1' }),
  ]
  for (const response of badRequests) {
    assert.equal(response.result_status, 'error')
    assert.equal(response.payload.left_rate, null)
    assert.equal(response.payload.comparable, false)
    assert.deepEqual(response.evidence_ids, [])
  }
  const standard = prepare_dataset(make_input())
  const outOfNode = compare_students(standard, { left_student_id: 'S1', right_student_id: 'S2', node_id: 'M1', item_ids: ['A2'] })
  assert.equal(outOfNode.result_status, 'error')
  assert.ok(outOfNode.payload.reason_codes.includes('item_not_allowed_in_node'))
})

test('multiple attempts from one peer do not multiply that student within an item mean', () => {
  const input = weightInput()
  input.records.push(make_record({
    记录编号: 'extra', 作答事件编号: 'extra', 学生编号: 'S2', 材料编号: 'A1', 满分: '1', 得分: '1',
    学生最终作答: 'ok', 评分点得分: 'A1P1=1',
  }))
  const response = compare_with_peers(prepare_dataset(input), { student_id: 'S1', node_id: 'M1', item_ids: ['A1'] })
  assert.equal(response.payload.items[0]?.right_count, 9)
  assert.equal(response.payload.items[0]?.right_record_count, 10)
  near(response.payload.right_rate, 0.5 / 9)
})

test('class summaries distinguish coverage, pending review, absent students, and untaught topics', () => {
  const input = make_input([
    make_record(),
    make_record({ 记录编号: 'R2', 作答事件编号: 'E2', 材料编号: 'A3', 满分: '2', 得分: '5', 评分点得分: 'A3P1=2' }),
  ])
  // 差异化处置（默认）：R2 得分5>满分2 但评分点合计2==满分 -> 纠正为2计入
  const dataset = prepare_dataset(input)
  const response = analyze_class(dataset, { class_id: 'C1', node_id: 'M1' })
  assert.equal(response.result_status, 'ok')
  assert.equal(response.payload.student_count, 2)
  assert.equal(response.payload.observed_student_count, 1)
  assert.equal(response.payload.scored_student_count, 1)
  assert.equal(response.payload.record_count, 2)
  assert.equal(response.payload.valid_record_count, 2)
  assert.equal(response.payload.review_count, 0)
  assert.equal(response.payload.earned_score, 3)
  assert.equal(response.payload.possible_score, 5)
  assert.equal(response.payload.coverage.available_item_count, 2)
  assert.equal(response.payload.coverage.valid_item_count, 2)
  // 保守模式：R2 隔离待复核（旧行为）
  const conservative = analyze_class(
    prepare_dataset(input, { policy: 'conservative' }), { class_id: 'C1', node_id: 'M1' })
  assert.equal(conservative.result_status, 'needs_review')
  assert.equal(conservative.payload.valid_record_count, 1)
  assert.equal(conservative.payload.review_count, 1)
  assert.equal(conservative.payload.earned_score, 1)
  assert.equal(conservative.payload.possible_score, 3)
  assert.equal(response.payload.topics.find(row => row.topic_id === 'T2')?.taught, false)
  assert.equal(response.payload.student_summaries.find(row => row.student_id === 'S2')?.score_rate, null)
  assert.equal(analyze_class(dataset, { class_id: 'C1', node_id: 'M2' }).result_status, 'insufficient_data')
  assert.equal(analyze_class(dataset, { class_id: 'missing', node_id: 'M1' }).result_status, 'error')
  assert.equal(analyze_class(dataset, { class_id: 'C1', node_id: 'missing' }).result_status, 'error')
})

const liveDirectory = process.env.STUDY_DATA_DIR
test('official Q025 baseline keeps peer exclusion and class comparison counts reproducible', {
  skip: liveDirectory ? false : 'Set STUDY_DATA_DIR to run private live-data comparison acceptance.',
}, async () => {
  assert.ok(liveDirectory)
  const dataset = prepare_dataset(await load_dataset(liveDirectory), { source_mode: 'live' })
  const peers = compare_with_peers(dataset, { student_id: 'D01', node_id: 'N01', item_ids: ['Q025'] })
  assert.equal(peers.result_status, 'ok')
  assert.equal(peers.payload.items[0]?.left_count, 1)
  assert.equal(peers.payload.items[0]?.right_count, 7)
  near(peers.payload.left_rate, 1)
  near(peers.payload.right_rate, 13 / 21)
  const classes = compare_classes(dataset, { left_class_id: 'DC01', right_class_id: 'DC02', node_id: 'N01', item_ids: ['Q025'] })
  assert.equal(classes.payload.items[0]?.left_count, 8)
  assert.equal(classes.payload.items[0]?.right_count, 8)
  near(classes.payload.left_rate, 16 / 24)
  near(classes.payload.right_rate, 10 / 24)
  const firstClass = analyze_class(dataset, { class_id: 'DC01', node_id: 'N02' })
  const secondClass = analyze_class(dataset, { class_id: 'DC02', node_id: 'N02' })
  assert.equal(firstClass.payload.student_count, 21)
  assert.equal(secondClass.payload.student_count, 19)
  assert.equal(firstClass.dataset_version, classes.dataset_version)
})
