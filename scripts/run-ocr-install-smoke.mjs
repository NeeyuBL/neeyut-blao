import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Run the production installer, including downloadFile and Windows PowerShell
// extraction, without launching Electron or touching the user's installed tools.
if (process.platform !== 'win32') {
  console.log('SKIP OCR installer smoke: Windows regression test.')
  process.exit(0)
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = await mkdtemp(join(tmpdir(), 'tblao-ocr-install-'))
const output = join(testRoot, 'smoke.cjs')

try {
  await build({
    entryPoints: [join(projectRoot, 'scripts/smoke-ocr-install.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    plugins: [{
      name: 'isolated-electron-user-data',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'ocr-smoke' }))
        builder.onLoad({ filter: /.*/, namespace: 'ocr-smoke' }, () => ({
          contents: `
            import { isAbsolute, relative } from 'node:path'
            export const app = {
              getPath(name) {
                const root = process.env.TBLAO_OCR_SMOKE_ROOT
                const dir = process.env.TBLAO_OCR_SMOKE_USERDATA
                if (name !== 'userData' || !root || !dir) throw new Error('Unconfigured test path')
                const child = relative(root, dir)
                if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unsafe test path')
                return dir
              }
            }
          `,
          loader: 'js'
        }))
      }
    }]
  })
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [output, ...process.argv.slice(2)], {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, TBLAO_OCR_SMOKE_ROOT: testRoot }
    })
    child.once('error', reject)
    child.once('exit', (status) => resolve(status ?? 1))
  })
  process.exitCode = code
} finally {
  // This exact directory is created above; no AppData or workspace cleanup.
  await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
