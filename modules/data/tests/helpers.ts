import type { CsvRow, DatasetInput } from '../types.ts'

/** Builds a synthetic response with the same field names as imported CSV rows.
 * @param overrides Fields to replace in the response.
 * @returns A fresh row containing no competition records.
 */
export function make_record(overrides: CsvRow = {}): CsvRow {
  return {
    记录编号: 'R1', 学生编号: 'S1', 材料编号: 'A1', 主题编号: 'T1',
    节点编号: 'M1', 作答事件编号: 'E1', 修订版本: '1',
    模拟提交时间: '2026-01-01T08:00:00+08:00', 评分状态: '已评分',
    得分: '1', 满分: '3', 学生最终作答: '1', 解答过程: '1. 尝试计算。',
    评分点得分: 'A1P1=1；A1P2=0；A1P3=0',
    ...overrides,
  }
}

/** Builds a small independent dataset for version, quality, and scope tests.
 * @param records Synthetic response rows; the default contains one scored event.
 * @returns Fresh source tables that a test can modify independently.
 */
export function make_input(records: CsvRow[] = [make_record()]): DatasetInput {
  return {
    students: [
      { 学生编号: 'S1', 模拟班级编号: 'C1', 年级: '7' },
      { 学生编号: 'S2', 模拟班级编号: 'C1', 年级: '7' },
      { 学生编号: 'S3', 模拟班级编号: 'C2', 年级: '7' },
    ],
    items: [
      { 材料编号: 'A1', 主题编号: 'T1', 材料类型: '题目', 题型: '解答题', 满分: '3', 参考答案: '3', 评分点: 'A1P1 计算第一步 1分\nA1P2 计算第二步 1分\nA1P3 得出结论 1分', 指标编号: 'I1' },
      { 材料编号: 'A2', 主题编号: 'T2', 材料类型: '题目', 题型: '填空题', 满分: '1', 参考答案: 'x>1', 评分点: 'A2P1 答案正确 1分', 指标编号: 'I3' },
      { 材料编号: 'A3', 主题编号: 'T1', 材料类型: '题目', 题型: '填空题', 满分: '2', 参考答案: 'a', 评分点: 'A3P1 答案正确 2分', 指标编号: 'I2' },
    ],
    nodes: [
      { 节点编号: 'M1', 模拟测验日期: '2026-01-01', 已教及测量主题: 'T1', 可用题目编号: 'A1、A3' },
      { 节点编号: 'M2', 模拟测验日期: '2026-06-01', 已教及测量主题: 'T1、T2', 可用题目编号: 'A1、A2、A3' },
    ],
    requirements: [
      { 主题编号: 'T1', 指标编号: 'I1', 主题: '合成主题一', 观察指标: '计算' },
      { 主题编号: 'T1', 指标编号: 'I2', 主题: '合成主题一', 观察指标: '表示' },
      { 主题编号: 'T2', 指标编号: 'I3', 主题: '合成主题二', 观察指标: '比较' },
    ],
    records: records.map(record => ({ ...record })),
  }
}
