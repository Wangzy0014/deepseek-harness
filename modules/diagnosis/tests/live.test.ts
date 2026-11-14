import assert from 'node:assert/strict'
import test from 'node:test'
import { prepare_dataset } from '../../data/core.ts'
import { load_dataset } from '../../data/io.ts'
import { diagnose_student, get_curriculum } from '../core.ts'

const directory = process.env.STUDY_DATA_DIR

test('released input connects curriculum and three contrasting students without exceeding their evidence', {
  skip: directory ? false : 'Set STUDY_DATA_DIR to run private released-input verification.',
}, async () => {
  assert.ok(directory)
  const dataset = prepare_dataset(await load_dataset(directory), { source_mode: 'live' })
  const curriculum = get_curriculum(dataset)
  assert.equal(curriculum.payload.topics.length, 3)
  assert.equal(curriculum.payload.entries.length, 9)
  assert.ok(curriculum.payload.entries.filter(entry => entry.topic_id === 'T01').every(entry => entry.material_ids.includes('B05')))
  assert.ok(curriculum.payload.entries.filter(entry => entry.topic_id === 'T02').every(entry => entry.material_ids.includes('B06')))
  assert.ok(curriculum.payload.entries.filter(entry => entry.topic_id === 'T03').every(entry => entry.material_ids.includes('B02')))
  const partial = diagnose_student(dataset, { student_id: 'D01', node_id: 'N02' })
  const direction = partial.payload.findings.find(finding => finding.finding_type === 'inequality_direction' && finding.evidence_ids.includes('DR0023'))!
  assert.ok(direction)
  assert.equal(direction.category, 'fact')
  assert.deepEqual(direction.step_refs, [3])
  assert.deepEqual(direction.point_refs, ['Q043P2'])
  assert.ok(direction.material_ids.includes('B02'))
  const strong = diagnose_student(dataset, { student_id: 'D14', node_id: 'N02' })
  assert.equal(strong.payload.stats.earned_score, 26)
  assert.equal(strong.payload.covered_indicator_ids.length, 6)
  assert.equal(strong.payload.findings.some(finding => finding.finding_type === 'partial_score'), false)
  const sparse = diagnose_student(dataset, { student_id: 'D17', node_id: 'N01' })
  assert.equal(sparse.payload.stats.earned_score, 8)
  assert.ok(sparse.payload.covered_indicator_ids.every(id => id.startsWith('T01')))
  assert.ok(sparse.payload.findings.some(finding => finding.category === 'insufficient_data'))
  const absent = diagnose_student(dataset, { student_id: 'D17', node_id: 'N02' })
  assert.equal(absent.result_status, 'insufficient_data')
  assert.equal(absent.payload.stats.score_rate, null)
  assert.equal(absent.payload.covered_indicator_ids.length, 0)
})
