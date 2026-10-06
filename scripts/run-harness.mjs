// EvidenceOS harness (Prompt 12): static checks -> unit -> contracts -> golden -> e2e -> report.
// It protects critical invariants rather than counting tests: any hard-rule failure, semantic
// regression or infrastructure failure means the harness does NOT pass.
//
// Test titles carry tags: [HARD] critical evidence-integrity invariant, [VARIANCE] tolerated model
// variance (reported, never blocking). Untagged failures are semantic regressions.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const workDir = join(tmpdir(), `evidenceos-harness-${process.pid}`)
mkdirSync(workDir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  stages: [],
  hardRuleFailures: [],
  semanticRegressions: [],
  infrastructureFailures: [],
  modelVariance: [],
  // Failure-injection cases (tests tagged [FAILURE]) are summarized so the report shows what was injected.
  failureInjection: { total: 0, passed: 0, cases: [] },
}

const STAGE_TIMEOUT_MS = 5 * 60 * 1000

function run(command) {
  // A stage that hangs must fail loudly (infrastructure) rather than block the harness forever.
  return spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: STAGE_TIMEOUT_MS })
}

function staticStage(name, command) {
  const result = run(command)
  const passed = result.status === 0
  report.stages.push({ name, passed })
  if (!passed) {
    // A type or lint error is a deterministic code defect, so it is a hard gate.
    report.hardRuleFailures.push({ stage: name, test: command, detail: (result.stdout + result.stderr).trim().slice(0, 500) })
  }
}

function testStage(name, path) {
  const outputFile = join(workDir, `${name}.json`)
  const result = run(`npm run test --workspace=@evidenceos/frontend --silent -- ${path} --reporter=json --outputFile="${outputFile}"`)
  let json
  try {
    json = JSON.parse(readFileSync(outputFile, 'utf8'))
  } catch {
    // No readable result means the runner itself failed: infrastructure, not behavior.
    report.stages.push({ name, passed: false, total: 0, failed: 0 })
    report.infrastructureFailures.push({ stage: name, detail: (result.stdout + result.stderr).trim().slice(0, 500) || 'test runner produced no report' })
    return
  }
  let total = 0
  let failed = 0
  for (const file of json.testResults ?? []) {
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) {
      report.infrastructureFailures.push({ stage: name, detail: `${file.name}: ${String(file.message ?? '').slice(0, 300)}` })
    }
    for (const test of file.assertionResults ?? []) {
      total += 1
      if (test.fullName.includes('[FAILURE]')) {
        report.failureInjection.total += 1
        if (test.status === 'passed') report.failureInjection.passed += 1
        report.failureInjection.cases.push({ name: test.fullName.split('[FAILURE]').pop().trim(), status: test.status })
      }
      if (test.status !== 'failed') continue
      failed += 1
      const entry = { stage: name, test: test.fullName, detail: String((test.failureMessages ?? [])[0] ?? '').split('\n')[0].slice(0, 300) }
      if (test.fullName.includes('[VARIANCE]')) report.modelVariance.push(entry)
      else if (test.fullName.includes('[HARD]')) report.hardRuleFailures.push(entry)
      else report.semanticRegressions.push(entry)
    }
  }
  const crashed = (json.numFailedTestSuites ?? 0) > 0 && failed === 0
  if (crashed && !report.infrastructureFailures.some((f) => f.stage === name)) {
    report.infrastructureFailures.push({ stage: name, detail: 'a test suite failed to run (no individual test failed)' })
  }
  report.stages.push({ name, passed: failed === 0 && !crashed, total, failed })
}

staticStage('typecheck', 'npm run typecheck --silent')
staticStage('lint', 'npm run lint --silent')
testStage('unit', 'tests/unit')
testStage('contracts', 'tests/contracts')
testStage('golden', 'tests/golden')
testStage('e2e', 'tests/e2e')

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
