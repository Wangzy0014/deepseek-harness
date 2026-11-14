/** Values representable by the JSON document embedded in a local report. */
export type ReportJson = null | boolean | number | string | ReportJson[] | { [key: string]: ReportJson }

type ReportNode = null | boolean | number | string | ['a', ...number[]] | ['o', ...number[]]

/** Child references always precede their containing array or object in the pool. */
export interface PackedReport {
  format: 'study-report-pool-v1'
  root: number
  nodes: ReportNode[]
}

/**
 * Deduplicate JSON keys, values and repeated subtrees for the HTML-only representation.
 * @param value - A JSON-serializable result; standard JSON omission and null rules apply.
 * @returns A deterministic pool without removing any serialized report fields.
 */
export function pack_report_value(value: unknown): PackedReport {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('报告必须包含可序列化的JSON值')
  const normalized = JSON.parse(serialized) as ReportJson
  const nodes: ReportNode[] = []
  const identifiers = new Map<string, number>()
  function encode(current: ReportJson): number {
    let node: ReportNode
    if (Array.isArray(current)) {
      node = ['a', ...current.map(encode)]
    } else if (current !== null && typeof current === 'object') {
      node = ['o']
      for (const [key, child] of Object.entries(current)) node.push(encode(key), encode(child))
    } else {
      node = current
    }
    const signature = JSON.stringify(node)
    const previous = identifiers.get(signature)
    if (previous !== undefined) return previous
    const identifier = nodes.length
    nodes.push(node)
    identifiers.set(signature, identifier)
    return identifier
  }
  const root = encode(normalized)
  return { format: 'study-report-pool-v1', root, nodes }
}

/**
 * Restore a complete JSON report using ordinary JavaScript and no network or browser codecs.
 * @param packed - Parsed HTML report pool with backward-only references.
 * @returns The JSON value; independently serialized subobjects remain independently mutable.
 * @throws If the pool format, references, object keys or node tags are invalid.
 */
export function unpack_report_value(packed: PackedReport): ReportJson {
  if (packed.format !== 'study-report-pool-v1' || !Array.isArray(packed.nodes)
    || !Number.isSafeInteger(packed.root) || packed.root < 0 || packed.root >= packed.nodes.length) {
    throw new Error('报告数据池格式或根引用无效')
  }
  for (let index = 0; index < packed.nodes.length; index += 1) {
    const node = packed.nodes[index]
    if (!Array.isArray(node)) {
      if (node !== null && typeof node !== 'string' && typeof node !== 'boolean'
        && !(typeof node === 'number' && Number.isFinite(node))) throw new Error('报告数据池包含非JSON值')
      continue
    }
    if (node[0] !== 'a' && node[0] !== 'o') throw new Error('报告数据池包含未知节点类型')
    if (node[0] === 'o' && (node.length - 1) % 2 !== 0) throw new Error('报告对象的键值引用不成对')
    const keys = new Set<string>()
    for (let child = 1; child < node.length; child += 1) {
      const reference = node[child]
      if (typeof reference !== 'number' || !Number.isSafeInteger(reference) || reference < 0 || reference >= index) {
        throw new Error('报告数据池包含无效或未先定义的引用')
      }
      if (node[0] === 'o' && child % 2 === 1) {
        const key = packed.nodes[reference]
        if (typeof key !== 'string' || keys.has(key)) throw new Error('报告对象的键无效或重复')
        keys.add(key)
      }
    }
  }
  function restore(identifier: number): ReportJson {
    const node = packed.nodes[identifier]!
    if (!Array.isArray(node)) return node
    if (node[0] === 'a') return node.slice(1).map(reference => restore(reference as number))
    const entries: Array<[string, ReportJson]> = []
    for (let index = 1; index < node.length; index += 2) {
      entries.push([packed.nodes[node[index] as number] as string, restore(node[index + 1] as number)])
    }
    return Object.fromEntries(entries)
  }
  return restore(packed.root)
}
