import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  formatBytes,
  projectRoot,
  totalFontBytes,
  verifyFontDirectory
} from './font-pack-utils.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function findMacFontDirs(distDir) {
  const matches = []
  if (!existsSync(distDir)) return matches

  const queue = [{ dir: distDir, depth: 0 }]
  while (queue.length) {
    const current = queue.shift()
    if (!current || current.depth > 5) continue
    for (const item of readdirSync(current.dir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue
      const next = join(current.dir, item.name)
      if (item.name === 'fonts' && /\.app[\\/]Contents[\\/]Resources$/i.test(current.dir)) {
        matches.push(next)
      } else {
        queue.push({ dir: next, depth: current.depth + 1 })
      }
    }
  }
  return matches
}

function candidateDirs() {
  const explicit = option('--fonts-dir')
  if (explicit) return [resolve(explicit)]

  const platform = option('--platform')
  const distDir = join(projectRoot, 'dist')
  if (platform === 'win') return [join(distDir, 'win-unpacked', 'resources', 'fonts')]
  if (platform === 'mac') return findMacFontDirs(distDir)
  throw new Error('use --platform win|mac or --fonts-dir <path>')
}

try {
  const dirs = candidateDirs().filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
  if (!dirs.length) throw new Error('no packaged resources/fonts directory was found')

  for (const dir of dirs) {
    const { manifest, entries } = verifyFontDirectory(dir, { requireExactBinaries: true })
    console.log(
      `[font-pack] packaged verification passed: ${dir} | ${entries.length} fonts | ${formatBytes(totalFontBytes(dir, entries))} | pack ${manifest.packVersion}`
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
