import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load as parseYaml } from 'js-yaml'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const assetDir = resolve(process.argv[2] || 'dist')
const version = pkg.version
const windowsExe = `T-blao-${version}-setup.exe`
const macBase = `T-blao-${version}-mac-arm64`
const required = [
  windowsExe,
  `${windowsExe}.blockmap`,
  'latest.yml',
  `${macBase}.dmg`,
  `${macBase}.dmg.blockmap`,
  `${macBase}.zip`,
  `${macBase}.zip.blockmap`,
  'latest-mac.yml'
]

for (const name of required) {
  const info = await stat(join(assetDir, name)).catch(() => null)
  if (!info?.isFile() || info.size <= 0) throw new Error(`Thiếu hoặc rỗng: ${name}`)
}

const windowsMeta = parseYaml(await readFile(join(assetDir, 'latest.yml'), 'utf8'))
const macMeta = parseYaml(await readFile(join(assetDir, 'latest-mac.yml'), 'utf8'))
const urls = (meta) => (Array.isArray(meta?.files) ? meta.files.map((file) => file?.url) : [])

if (windowsMeta?.version !== version || windowsMeta?.path !== windowsExe || !urls(windowsMeta).includes(windowsExe)) {
  throw new Error('latest.yml không trỏ đúng bộ cài Windows của version hiện tại')
}
if (
  macMeta?.version !== version ||
  macMeta?.path !== `${macBase}.zip` ||
  !urls(macMeta).includes(`${macBase}.zip`)
) {
  throw new Error('latest-mac.yml không trỏ đúng ZIP macOS ARM64 của version hiện tại')
}

console.log(`Release artifacts OK: ${required.length} file cho v${version}`)
