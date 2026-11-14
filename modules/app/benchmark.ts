import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { load_dataset } from '../data/io.ts'
import { build_workspace } from './core.ts'
import { prepare_workspace_dataset } from './pipeline.ts'
import { render_report } from './report.ts'
import { verify_workspace } from './verify.ts'

/**
 * Measure one local input without printing student content or imposing timing thresholds.
 * @param directory - Directory containing the five source CSV tables.
 * @param iterations - Odd sample count from 1 to 31; the median reduces isolated scheduling noise.
 * @returns Measured milliseconds and bytes, valid only for the current input and host.
 */
export async function benchmark_report(directory: string, iterations = 7): Promise<Record<string, unknown>> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 31 || iterations % 2 === 0) throw new Error('iterations须为1到31之间的奇数')
  const input = await load_dataset(directory)
  const samples: Array<{ prepare_ms: number; workspace_ms: number; verify_ms: number; render_ms: number; analysis_ms: number; total_ms: number }> = []
  let htmlBytes = 0, jsonBytes = 0
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now()
    const dataset = prepare_workspace_dataset(input)
    const prepared = performance.now()
    const workspace = build_workspace(dataset)
    const built = performance.now()
    const verification = verify_workspace(workspace)
    const verified = performance.now()
    if (verification.status !== 'passed') throw new Error('报告一致性检查未通过，不能计为有效基准')
    const html = await render_report(workspace)
    const rendered = performance.now()
    htmlBytes = Buffer.byteLength(html)
    jsonBytes = Buffer.byteLength(JSON.stringify(workspace))
    samples.push({ prepare_ms: prepared - start, workspace_ms: built - prepared, verify_ms: verified - built,
      render_ms: rendered - verified, analysis_ms: verified - start, total_ms: rendered - start })
  }
  const keys = ['prepare_ms', 'workspace_ms', 'verify_ms', 'render_ms', 'analysis_ms', 'total_ms'] as const
  const median = Object.fromEntries(keys.map(key => [key, samples.map(sample => sample[key]).sort((a, b) => a - b)[Math.floor(iterations / 2)]]))
  return { iterations, median, html_bytes: htmlBytes, machine_json_bytes: jsonBytes,
    limitations: ['仅是当前输入、当前机器的本地测量，不代表其他数据规模或浏览器加载速度。', 'analysis_ms不含HTML编码；render_ms含完整报告去重与资产读取。'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs({ options: { data: { type: 'string' }, iterations: { type: 'string', default: '7' } } })
  if (!args.values.data || !/^[1-9]\d*$/u.test(args.values.iterations)) throw new Error('请提供--data目录及合法的--iterations奇数')
  void benchmark_report(args.values.data, Number(args.values.iterations)).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : '基准测量失败'}\n`); process.exitCode = 1 })
}
