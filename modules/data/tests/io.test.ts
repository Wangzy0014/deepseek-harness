import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load_dataset, parse_csv } from '../io.ts'
import type { CsvRow, DatasetInput } from '../types.ts'
import { make_input } from './helpers.ts'

function encode_csv(rows: CsvRow[]): string {
  const headers = Object.keys(rows[0] ?? {})
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`
  return [headers.map(quote).join(','), ...rows.map(row => headers.map(header => quote(row[header] ?? '')).join(','))].join('\r\n')
}

const sourceNames: Record<keyof DatasetInput, string> = {
  students: '模拟学生.csv', items: '题目与材料.csv', nodes: '测验节点.csv',
  requirements: '课程要求.csv', records: '作答记录.csv',
}

test('CSV preserves identifiers, quoted commas, escaped quotes, and multiline evidence', () => {
  const csv = '\uFEFF学生编号,解答过程,得分\r\n001,"第一步,观察\r\n第二步说""继续""",0\r\n'
  assert.deepEqual(parse_csv(csv, 'example.csv', ['学生编号', '解答过程', '得分']), [{
    学生编号: '001', 解答过程: '第一步,观察\r\n第二步说"继续"', 得分: '0',
  }])
})

test('malformed CSV fails before partially parsed rows become analysis input', async t => {
  const examples = [
    ['duplicate header', 'id,id\na,b'],
    ['missing required header', 'id,value\na,b'],
    ['too many columns', 'id,value\na,b,c'],
    ['too few columns', 'id,value\na'],
    ['unterminated quote', 'id,value\na,"unfinished'],
    ['empty header', 'id,\na,b'],
  ] as const
  for (const [name, csv] of examples) {
    await t.test(name, () => {
      const required = name === 'missing required header' ? ['missing'] : undefined
      assert.throws(() => parse_csv(csv, 'invalid.csv', required))
    })
  }
})

test('loader reads the five source tables without requiring optional dictionary files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'study-data-loader-'))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  const input = make_input()
  for (const key of Object.keys(sourceNames) as Array<keyof DatasetInput>) {
    await writeFile(join(directory, sourceNames[key]), encode_csv(input[key]), 'utf8')
  }
  assert.deepEqual(await load_dataset(directory), input)
})

test('loader rejects an incomplete directory with a useful missing-source error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'study-data-missing-'))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  await assert.rejects(load_dataset(directory), /csv|文件|table|source|ENOENT/i)
})

test('loader rejects invalid UTF-8 instead of replacing characters in evidence or identifiers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'study-data-encoding-'))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  const input = make_input()
  for (const key of Object.keys(sourceNames) as Array<keyof DatasetInput>) {
    await writeFile(join(directory, sourceNames[key]), encode_csv(input[key]), 'utf8')
  }
  await writeFile(join(directory, '作答记录.csv'), Buffer.from([0xc3, 0x28]))
  await assert.rejects(load_dataset(directory), /utf|encoding|编码/i)
})
