// EvidenceOS harness: static checks -> backend (Python) tests -> frontend (UI) tests -> report.
// It protects critical invariants rather than counting tests: any hard-rule failure, semantic
// regression or infrastructure failure means the harness does NOT pass.
//
// Backend tests are pytest tests; the markers decide how a failure is classified:
//   @pytest.mark.hard      critical evidence-integrity invariant (blocking)
//   @pytest.mark.variance  tolerated model variance (reported, never blocking)
//   @pytest.mark.failure   an injected fault (counted in the failure-injection summary)
// Unmarked failures are semantic regressions. Frontend titles use the same [HARD]/[VARIANCE] tags.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backendDir, pythonCommand } from './py.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const workDir = join(tmpdir(), `evidenceos-harness-${process.pid}`)
mkdirSync(workDir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  stages: [],
  hardRuleFailures: [],
  semanticRegressions: [],
  infrastructureFailures: [],
  modelVariance: [],
  // Failure-injection cases are summarized so the report shows what was injected.
  failureInjection: { total: 0, passed: 0, cases: [] },
}

const STAGE_TIMEOUT_MS = 5 * 60 * 1000
const quote = (value) => (/\s/.test(value) ? `"${value}"` : value)

function run(command, options = {}) {
  // A stage that hangs must fail loudly (infrastructure) rather than block the harness forever.
  return spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: STAGE_TIMEOUT_MS, ...options })
}

function staticStage(name, command, options = {}) {
  const result = run(command, options)
  const passed = result.status === 0
  report.stages.push({ name, passed })
  if (!passed) {
    // A type or lint error is a deterministic code defect, so it is a hard gate.
    report.hardRuleFailures.push({ stage: name, test: command, detail: (result.stdout + result.stderr).trim().slice(0, 500) })
  }
}

function classify(stage, name, markers, detail) {
  const entry = { stage, test: name, detail }
  if (markers.includes('variance')) report.modelVariance.push(entry)
  else if (markers.includes('hard')) report.hardRuleFailures.push(entry)
  else report.semanticRegressions.push(entry)
}

/** Backend stages are named after the test module groups; `groups` maps a stage to its modules. */
const BACKEND_STAGES = {
  unit: ['test_rules', 'test_graph'],
  contracts: ['test_operations', 'test_http_api', 'test_adapters', 'test_data_model', 'test_wire_contract'],
  golden: ['test_agents', 'test_golden_dataset'],
  e2e: ['test_workflow', 'test_demo', 'test_failure_injection'],
}

function backendStages() {
  const outputFile = join(workDir, 'backend.json')
  const result = spawnSync(pythonCommand(), ['-m', 'pytest', '-p', 'no:cacheprovider'], {
    cwd: backendDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: STAGE_TIMEOUT_MS,
    env: { ...process.env, EVIDENCEOS_HARNESS_JSON: outputFile },
  })
  let data
  try {
    data = JSON.parse(readFileSync(outputFile, 'utf8'))
  } catch {
    // No readable result means the runner itself failed: infrastructure, not behavior.
    for (const name of Object.keys(BACKEND_STAGES)) report.stages.push({ name, passed: false, total: 0, failed: 0 })
    report.infrastructureFailures.push({ stage: 'backend', detail: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(-500) || 'pytest produced no report' })
    return
  }
  const counts = Object.fromEntries(Object.keys(BACKEND_STAGES).map((name) => [name, { total: 0, failed: 0 }]))
  for (const item of data.results) {
    const module = item.id.split('::')[0].split(/[\\/]/).pop().replace(/\.py$/, '')
    const stage = Object.entries(BACKEND_STAGES).find(([, modules]) => modules.includes(module))?.[0] ?? 'unit'
    if (item.phase === 'setup') {
      // A fixture that could not start (database, event loop) is an infrastructure problem, not a verdict.
      report.infrastructureFailures.push({ stage, detail: `${item.id}: ${item.detail}` })
      counts[stage].failed += 1
      continue
    }
    counts[stage].total += 1
    if (item.markers.includes('failure')) {
      report.failureInjection.total += 1
      if (item.outcome === 'passed') report.failureInjection.passed += 1
      report.failureInjection.cases.push({ name: item.id.split('::').pop(), status: item.outcome })
    }
    if (item.outcome === 'failed') {
      counts[stage].failed += 1
      classify(stage, item.id, item.markers, item.detail)
    }
  }
  const collectionBroke = data.exitstatus !== 0 && data.exitstatus !== 1 // 2+ = interrupted, usage or internal error
  if (collectionBroke) report.infrastructureFailures.push({ stage: 'backend', detail: `pytest exited with status ${data.exitstatus}` })
  for (const [name, { total, failed }] of Object.entries(counts)) {
    report.stages.push({ name, passed: failed === 0 && !collectionBroke, total, failed })
  }
}

function frontendStage() {
  const outputFile = join(workDir, 'frontend.json')
  const result = run(`npm run test --workspace=@evidenceos/frontend --silent -- --reporter=json --outputFile=${quote(outputFile)}`)
  let json
  try {
    json = JSON.parse(readFileSync(outputFile, 'utf8'))
  } catch {
    report.stages.push({ name: 'ui', passed: false, total: 0, failed: 0 })
    report.infrastructureFailures.push({ stage: 'ui', detail: (result.stdout + result.stderr).trim().slice(0, 500) || 'test runner produced no report' })
    return
  }
  let total = 0
  let failed = 0
  for (const file of json.testResults ?? []) {
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) {
      report.infrastructureFailures.push({ stage: 'ui', detail: `${file.name}: ${String(file.message ?? '').slice(0, 300)}` })
    }
    for (const test of file.assertionResults ?? []) {
      total += 1
      if (test.status !== 'failed') continue
      failed += 1
      const markers = test.fullName.includes('[VARIANCE]') ? ['variance'] : test.fullName.includes('[HARD]') ? ['hard'] : []
      classify('ui', test.fullName, markers, String((test.failureMessages ?? [])[0] ?? '').split('\n')[0].slice(0, 300))
    }
  }
  const crashed = (json.numFailedTestSuites ?? 0) > 0 && failed === 0
  if (crashed && !report.infrastructureFailures.some((f) => f.stage === 'ui')) {
    report.infrastructureFailures.push({ stage: 'ui', detail: 'a test suite failed to run (no individual test failed)' })
  }
  report.stages.push({ name: 'ui', passed: failed === 0 && !crashed, total, failed })
}

const py = quote(pythonCommand())
staticStage('typecheck', 'npm run typecheck --silent')
staticStage('lint', 'npm run lint --silent')
staticStage('backend-lint', `${py} -m ruff check .`, { cwd: backendDir })
staticStage('backend-types', `${py} -m mypy evidenceos`, { cwd: backendDir })
backendStages()
frontendStage()

rmSync(workDir, { recursive: true, force: true })

const gates = {
  hardRuleFailures: report.hardRuleFailures.length,
  semanticRegressions: report.semanticRegressions.length,
  infrastructureFailures: report.infrastructureFailures.length,
}
const passed = Object.values(gates).every((n) => n === 0) && report.stages.every((s) => s.passed)
const outcome = { ...report, finishedAt: new Date().toISOString(), result: passed ? 'PASS' : 'FAIL' }
writeFileSync(join(root, 'harness-report.json'), `${JSON.stringify(outcome, null, 2)}\n`)

for (const stage of report.stages) {
  console.log(`${stage.passed ? 'PASS' : 'FAIL'}  ${stage.name}${stage.total === undefined ? '' : `  (${stage.total - stage.failed}/${stage.total})`}`)
}
const show = (title, items) => {
  if (items.length === 0) return
  console.log(`\n${title} (${items.length})`)
  for (const item of items) console.log(`  - [${item.stage}] ${item.test ?? ''} ${item.detail ?? ''}`.trimEnd())
}
show('HARD-RULE FAILURES (blocking)', report.hardRuleFailures)
show('SEMANTIC REGRESSIONS (blocking)', report.semanticRegressions)
show('INFRASTRUCTURE FAILURES (blocking, not a behavior verdict)', report.infrastructureFailures)
show('MODEL VARIANCE (non-blocking)', report.modelVariance)
if (report.failureInjection.total > 0) {
  console.log(`\nFailure injection: ${report.failureInjection.passed}/${report.failureInjection.total} cases handled safely`)
}
console.log(`\nHARNESS ${outcome.result}  (report: harness-report.json)`)
process.exitCode = passed ? 0 : report.infrastructureFailures.length > 0 ? 2 : 1
