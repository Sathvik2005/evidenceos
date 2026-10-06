// Creates backend/.venv and installs the backend with its development tools. Usage: npm run backend:setup
// Requires Python 3.11+ on PATH (`python3` or `python`).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { backendDir, pythonCommand } from './py.mjs'

const venvPython = process.platform === 'win32' ? join(backendDir, '.venv', 'Scripts', 'python.exe') : join(backendDir, '.venv', 'bin', 'python')
const system = process.platform === 'win32' ? 'python' : 'python3'

function step(command, args) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: backendDir, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`failed: ${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(venvPython)) step(system, ['-m', 'venv', '.venv'])
step(pythonCommand(), ['-m', 'pip', 'install', '--upgrade', 'pip'])
step(pythonCommand(), ['-m', 'pip', 'install', '-e', '.[dev]'])
console.log('\nBackend ready. Next: npm run test:backend')
