import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(scriptsDir, '..')
// Keep the temporary output under the repository so CommonJS resolution finds
// this checkout's node_modules on Windows, macOS, and Linux.
const outputDir = mkdtempSync(join(projectRoot, '.subtitle-smoke-'))

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
  return result.status === 0
}

try {
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  const compiled = run(process.execPath, [
    tsc,
    'scripts/smoke-subtitles.ts',
    '--outDir',
    outputDir,
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--target',
    'ES2022',
    '--lib',
    'ES2022,DOM',
    '--types',
    'node',
    '--esModuleInterop',
    '--skipLibCheck'
  ])
  if (compiled) run(process.execPath, [join(outputDir, 'scripts', 'smoke-subtitles.js')])
} finally {
  rmSync(outputDir, { recursive: true, force: true })
}
