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

  for (const id of ['DR0081', 'DR0133', 'DR0361', 'DR0515', 'DR0535', 'DR0685']) {
    const row = ds.current.find(record => record.record_id === id)
    assert.ok(row, `Missing ${id}`)
    assert.ok(row.quality_issues.length > 0, `${id} must have a documented review reason`)
    assert.equal(row.include_in_statistics, false, `${id} must not enter statistics before review`)
  }

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
