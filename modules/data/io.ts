import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Papa from 'papaparse'
import type { CsvRow, DatasetInput } from './types.ts'

const TABLES = {
  students: ['模拟学生.csv', ['学生编号', '模拟班级编号', '年级']],
  items: ['题目与材料.csv', ['材料编号', '主题编号', '材料类型', '满分', '指标编号', '参考答案']],
  nodes: ['测验节点.csv', ['节点编号', '已教及测量主题', '可用题目编号']],
  requirements: ['课程要求.csv', ['主题编号', '指标编号']],
  records: ['作答记录.csv', ['记录编号', '学生编号', '材料编号', '主题编号', '节点编号', '作答事件编号', '修订版本', '评分状态', '得分', '满分', '学生最终作答', '解答过程', '评分点得分']],
} as const

/**
 * Parse literal CSV fields and reject ambiguous or malformed table structure.
 * @param text - Decoded UTF-8 CSV, optionally with a BOM.
 * @param source - Filename used in actionable parse errors.
 * @param requiredHeaders - Columns needed by the owning source table.
 * @returns Records retaining original field text, including embedded newlines.
 */
export function parse_csv(text: string, source: string, requiredHeaders: readonly string[] = []): CsvRow[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: ',',
    header: false,
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.length > 0) {
    throw new Error(`${source}: CSV格式错误 (${parsed.errors.map(error => error.message).join('; ')})`)
  }
  const [headers, ...rows] = parsed.data
  if (!headers || headers.length === 0 || headers.some(header => header.trim() === '')) {
    throw new Error(`${source}: 缺少表头或存在空表头`)
  }
  if (new Set(headers).size !== headers.length) throw new Error(`${source}: 存在重复表头`)
  const missing = requiredHeaders.filter(header => !headers.includes(header))
  if (missing.length > 0) throw new Error(`${source}: 缺少必需字段 ${missing.join('、')}`)
  return rows.map((row, index) => {
    if (row.length !== headers.length) throw new Error(`${source}: 第${index + 2}条逻辑行的列数与表头不一致`)
    return Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']))
  })
}

/**
 * Load the five officially named CSV tables locally without contacting a model or network.
 * @param directory - Directory directly containing the simulation CSV files.
 * @returns Literal source rows; preparation owns deduplication and quality review.
 */
export async function load_dataset(directory: string): Promise<DatasetInput> {
  const input: DatasetInput = { students: [], items: [], nodes: [], requirements: [], records: [] }
  await Promise.all((Object.keys(TABLES) as Array<keyof typeof TABLES>).map(async key => {
    const [filename, headers] = TABLES[key]
    const path = resolve(directory, filename)
    const bytes = await readFile(path)
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (error) {
      throw new Error(`${filename}: 不是有效的UTF-8编码`, { cause: error })
    }
    input[key] = parse_csv(text, filename, headers)
  }))
  return input
}
