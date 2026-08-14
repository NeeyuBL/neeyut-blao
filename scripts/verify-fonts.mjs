import {
  formatBytes,
  sourceFontsDir,
  totalFontBytes,
  verifyFontDirectory
} from './font-pack-utils.mjs'

try {
  const { manifest, entries } = verifyFontDirectory(sourceFontsDir)
  console.log(
    `[font-pack] verified ${entries.length} bundled fonts (${formatBytes(totalFontBytes(sourceFontsDir, entries))}), pack ${manifest.packVersion}`
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
