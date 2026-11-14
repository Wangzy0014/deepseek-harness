import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { Window } from '../../data/node_modules/happy-dom/lib/index.js'
import type { DatasetInput } from '../../data/types.ts'
import { build_workspace } from '../core.ts'
import { make_demo_input } from '../demo.ts'
import { prepare_workspace_dataset } from '../pipeline.ts'

type DownloadBlob = InstanceType<Window['Blob']>
interface Download { filename: string; blob: DownloadBlob }

async function setup(t: TestContext, input: DatasetInput = make_demo_input()) {
  const workspace = build_workspace(prepare_workspace_dataset(input, { source_mode: 'fixture', producer_version: 'viewer-test' }))
  const window = new Window({
    settings: {
      enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true, enableCSSFileLoading: false, enableImageFileLoading: false,
      enableIframePageLoading: false,
      navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true, disableFallbackToSetURL: true },
    },
  })
  t.after(async () => { await window.happyDOM.close() })
  let networkRequests = 0
  window.fetch = async () => { networkRequests += 1; throw new Error('Offline DOM tests must not contact a network.') }
  const app = window.document.createElement('div')
  app.id = 'app'
  window.document.body.append(app)
  const blobs = new Map<string, DownloadBlob>()
  const downloads: Download[] = []
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: (blob: DownloadBlob) => {
    const key = `blob:offline-test-${blobs.size + 1}`
    blobs.set(key, blob)
    return key
  } })
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: (url: string) => { blobs.delete(url) } })
  Object.defineProperty(window.HTMLAnchorElement.prototype, 'click', { configurable: true,
    value: function (this: InstanceType<Window['HTMLAnchorElement']>) {
      const blob = blobs.get(this.href)
      assert.ok(blob, 'A download must reference a captured local Blob.')
      downloads.push({ filename: this.download, blob })
    },
  })
  const calls = { students: 0, peers: 0, classes: 0, classAnalysis: 0 }
  Object.defineProperty(window, '__comparisonCalls', { value: calls })
  const [comparison, viewer] = await Promise.all([
    readFile(new URL('../../data/lib/companion/comparison/core.js', import.meta.url), 'utf8'),
    readFile(new URL('../viewer.js', import.meta.url), 'utf8'),
  ])
  assert.ok(!/^import\s/m.test(comparison), 'The offline report must use its dependency-free comparison artifact.')
  const wrapped = `
const originalCompareStudents = compare_students;
compare_students = (...args) => { globalThis.__comparisonCalls.students += 1; return originalCompareStudents(...args); };
const originalComparePeers = compare_with_peers;
compare_with_peers = (...args) => { globalThis.__comparisonCalls.peers += 1; return originalComparePeers(...args); };
const originalCompareClasses = compare_classes;
compare_classes = (...args) => { globalThis.__comparisonCalls.classes += 1; return originalCompareClasses(...args); };
const originalClassAnalysis = analyze_class;
analyze_class = (...args) => { globalThis.__comparisonCalls.classAnalysis += 1; return originalClassAnalysis(...args); };
`
  window.eval(`${comparison.replace(/^export\s+/gm, '')}\n${wrapped}\nconst WORKSPACE = ${JSON.stringify(workspace)};\n${viewer}`)
  return { window, workspace, downloads, calls, networkRequests: () => networkRequests }
}

function click(window: Window, label: string): void {
  const button = [...window.document.querySelectorAll('button')].find(element => element.textContent?.trim() === label
    || (element.classList.contains('nav-button') && element.lastElementChild?.textContent?.trim() === label))
  assert.ok(button, `Missing button: ${label}`)
  assert.equal(button.disabled, false, `Disabled button: ${label}`)
  button.click()
}

function choose(window: Window, label: string, value: string): void {
  const select = [...window.document.querySelectorAll('select')].find(element => element.getAttribute('aria-label') === label)
  assert.ok(select, `Missing select: ${label}`)
  select.value = value
  select.dispatchEvent(new window.Event('change', { bubbles: true }))
}

function mainText(window: Window): string {
  return window.document.querySelector('main')?.textContent ?? ''
}

test('offline teacher report navigates seven pages without loading external resources', async t => {
  const { window, networkRequests } = await setup(t)
  const labels = ['总览', '学生诊断', '学习计划', '比较分析', '班级报告', '课程依据', '质量复核']
  assert.equal(window.document.querySelectorAll('nav button').length, 7)
  for (const label of labels) {
    click(window, label)
    assert.equal(window.document.querySelector('h1')?.textContent, label)
    assert.equal(window.document.querySelectorAll('nav [aria-current="page"]').length, 1)
    assert.ok(mainText(window).includes('教师备注'))
  }
  assert.equal(window.document.querySelectorAll('script[src],link[href],iframe,img').length, 0)
  assert.equal(networkRequests(), 0)
})

test('student and node changes retain an explicit empty-evidence state rather than a zero', async t => {
  const { window } = await setup(t)
  click(window, '学生诊断')
  choose(window, '模拟学生', 'DEMO-C')
  assert.ok(window.document.querySelector('.node-description')?.textContent.includes('DEMO-C · CHECK-2'))
  assert.ok(mainText(window).includes('暂无可计分证据'))
  assert.ok(mainText(window).includes('该学生在指定节点没有作答记录'))
  choose(window, '测验节点', 'CHECK-1')
  assert.ok(window.document.querySelector('.node-description')?.textContent.includes('DEMO-C · CHECK-1'))
  assert.ok(window.document.querySelector('.metrics')?.textContent.includes('100%'))
  assert.ok(mainText(window).includes('本节点未教'))
})

test('comparison controls invoke the original algorithms for peers, students, and classes', async t => {
  const { window, calls } = await setup(t)
  click(window, '比较分析')
  assert.ok(calls.peers > 0)
  assert.ok(mainText(window).includes('-40 个百分点'))
  choose(window, '比较方式', 'students')
  choose(window, '右侧学生', 'DEMO-B')
  assert.ok(calls.students > 0)
  assert.ok(mainText(window).includes('-40 个百分点'))
  choose(window, '比较方式', 'classes')
  assert.ok(calls.classes > 0)
  assert.ok(mainText(window).includes('没有共同有效题'))
  assert.ok(mainText(window).includes('暂无可比结果'))
  choose(window, '测验节点', 'CHECK-1')
  assert.ok(mainText(window).includes('0 个百分点'))
  assert.ok(mainText(window).includes('EX-B'))
  click(window, '班级报告')
  choose(window, '选择班级', 'GROUP-B')
  assert.ok(calls.classAnalysis > 0)
  assert.ok(mainText(window).includes('DEMO-C'))
})

test('evidence dialogs expose the selected raw response and close without changing analysis', async t => {
  const { window, workspace } = await setup(t)
  const before = JSON.stringify(workspace)
  click(window, '学生诊断')
  click(window, 'RECORD-DEMO-A-CHECK-2-EX-C')
  const dialog = window.document.querySelector('dialog')
  assert.ok(dialog)
  assert.equal(dialog.open, true)
  assert.ok(dialog.textContent.includes('z<-3'))
  assert.ok(dialog.textContent.includes('-4z<12'))
  assert.ok(dialog.textContent.includes('EX-CP2=0'))
  assert.ok(dialog.textContent.includes('作答记录.csv'))
  click(window, '关闭')
  assert.equal(window.document.querySelector('dialog'), null)
  assert.equal(JSON.stringify(workspace), before)
})

test('progressive student hints unlock in order and student exports omit raw and reference answers', async t => {
  const { window, downloads } = await setup(t)
  click(window, '学习计划')
  const question = [...window.document.querySelectorAll('.question')].find(element => element.querySelector('strong')?.textContent === 'EX-C')
  assert.ok(question)
  const buttons = [...question.querySelectorAll('button')]
  assert.equal(buttons.length, 3)
  assert.deepEqual(buttons.map(button => button.disabled), [false, true, true])
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index]!
    assert.equal(button.disabled, false)
    button.click()
    const hint = question.querySelector('.hint-text')?.textContent ?? ''
    assert.ok(hint.length > 0)
    assert.ok(!hint.includes('z>-3'))
    assert.ok(!hint.includes('z<-3'))
    if (index < 2) assert.equal(buttons[index + 1]?.disabled, false)
  }
  click(window, '导出学生练习清单')
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0]?.filename, 'DEMO-A-CHECK-2-student-plan.json')
  const text = await downloads[0]!.blob.text()
  const output = JSON.parse(text)
  assert.equal(output.scope.student_id, 'DEMO-A')
  assert.ok(output.payload.activities.length > 0)
  assert.ok(!text.includes('z>-3'))
  assert.ok(!text.includes('z<-3'))
  assert.ok(!text.includes('original_values'))
  assert.ok(!text.includes('reference_answer'))
  assert.ok(!text.includes('teacher_solution'))
  assert.ok(!text.includes('评分点得分'))
})

test('JSON downloads keep teacher notes separate from statistics and diagnosis facts', async t => {
  const { window, workspace, downloads } = await setup(t)
  const before = JSON.stringify(workspace)
  click(window, '学生诊断')
  const textarea = window.document.querySelector('textarea')
  assert.ok(textarea)
  textarea.value = '教师备注：下次补充独立作答；当前事实保持不变。'
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
  click(window, '导出备注')
  const noteExport = JSON.parse(await downloads[0]!.blob.text())
  assert.equal(noteExport.kind, 'teacher_notes')
  assert.equal(noteExport.changes_facts, false)
  assert.equal(noteExport.notes['diagnosis:DEMO-A:CHECK-2'], textarea.value)
  click(window, '导出当前 JSON')
  const diagnosisExport = JSON.parse(await downloads[1]!.blob.text())
  assert.deepEqual(diagnosisExport, workspace.payload.cases['DEMO-A:CHECK-2']!.diagnosis)
  assert.equal(Object.hasOwn(diagnosisExport.payload, 'notes'), false)
  click(window, '总览')
  click(window, '学生诊断')
  assert.equal(window.document.querySelector('textarea')?.value, textarea.value)
  assert.equal(JSON.stringify(workspace), before)
})

test('imported markup stays literal text and does not create active DOM elements', async t => {
  const input = make_demo_input()
  const malicious = '<img src="blocked.invalid" onerror="globalThis.__unexpectedMarkup = true">'
  input.items.find(item => item['材料编号'] === 'EX-C')!['题干或内容'] += malicious
  const { window, networkRequests } = await setup(t, input)
  click(window, '学习计划')
  assert.ok(mainText(window).includes(malicious))
  assert.equal(window.document.querySelector('img'), null)
  assert.equal(window.eval('globalThis.__unexpectedMarkup'), undefined)
  assert.equal(networkRequests(), 0)
})
