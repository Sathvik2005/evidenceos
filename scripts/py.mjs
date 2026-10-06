// Runs the Python backend's tools from the repository root, so `npm run ...` works without activating a venv.
//   node scripts/py.mjs -m evidenceos.cli.migrate
// It uses $EVIDENCEOS_PYTHON if set, else backend/.venv, else `python3`/`python` on PATH. Arguments are passed through untouched.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const backendDir = fileURLToPath(new URL('../backend/', import.meta.url))

export function pythonCommand() {
  if (process.env.EVIDENCEOS_PYTHON) return process.env.EVIDENCEOS_PYTHON
  const venv = process.platform === 'win32' ? join(backendDir, '.venv', 'Scripts', 'python.exe') : join(backendDir, '.venv', 'bin', 'python')
  if (existsSync(venv)) return venv
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function runPython(args, options = {}) {
  return spawnSync(pythonCommand(), args, { cwd: backendDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runPython(process.argv.slice(2), { stdio: 'inherit', encoding: undefined })
  if (result.error) {
    console.error(`could not start Python (${pythonCommand()}): ${result.error.message}\nSee backend/README.md to set up the virtual environment.`)
    process.exit(2)
  }
  process.exit(result.status ?? 1)
}
