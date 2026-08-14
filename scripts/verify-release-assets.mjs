import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
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
  `${macBase}.dmg.sha256`
]

for (const name of required) {
  const info = await stat(join(assetDir, name)).catch(() => null)
  if (!info?.isFile() || info.size <= 0) throw new Error(`Thiếu hoặc rỗng: ${name}`)
}

const windowsMeta = parseYaml(await readFile(join(assetDir, 'latest.yml'), 'utf8'))
const urls = (meta) => (Array.isArray(meta?.files) ? meta.files.map((file) => file?.url) : [])

if (windowsMeta?.version !== version || windowsMeta?.path !== windowsExe || !urls(windowsMeta).includes(windowsExe)) {
  throw new Error('latest.yml không trỏ đúng bộ cài Windows của version hiện tại')
}
const names = await readdir(assetDir)
const forbidden = names.filter((name) => name === 'latest-mac.yml' || name.endsWith('.zip'))
if (forbidden.length) {
  throw new Error(`Luồng macOS thủ công không được phát hành updater ZIP/metadata: ${forbidden.join(', ')}`)
}

const checksumText = (await readFile(join(assetDir, `${macBase}.dmg.sha256`), 'utf8')).trim()
const checksumMatch = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(checksumText)
if (!checksumMatch || checksumMatch[2] !== `${macBase}.dmg`) {
  throw new Error('File SHA-256 macOS không đúng định dạng hoặc sai tên DMG')
}
const hash = createHash('sha256')
for await (const chunk of createReadStream(join(assetDir, `${macBase}.dmg`))) hash.update(chunk)
if (hash.digest('hex') !== checksumMatch[1].toLowerCase()) {
  throw new Error('SHA-256 của DMG macOS không khớp')
}

console.log(`Release artifacts OK: ${required.length} file cho v${version}`)
