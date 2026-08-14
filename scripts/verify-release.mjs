import { readFile } from 'node:fs/promises'
import { load as parseYaml } from 'js-yaml'

const root = new URL('../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const pkg = await readJson('package.json')
const lock = await readJson('package-lock.json')
const notes = (await readFile(new URL('RELEASE_NOTES.md', root), 'utf8')).replace(/\r\n/g, '\n')
const builder = parseYaml(await readFile(new URL('electron-builder.yml', root), 'utf8'))
const requestedTag = process.argv[2] || process.env.RELEASE_TAG || ''

const fail = (message) => {
  throw new Error(`Release gate: ${message}`)
}

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`version không hợp lệ: ${pkg.version}`)
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  fail('package.json và package-lock.json không cùng version')
}
if (!notes.startsWith(`## T-blao v${pkg.version}\n`)) {
  fail(`RELEASE_NOTES.md phải bắt đầu bằng "## T-blao v${pkg.version}"`)
}
if (requestedTag && requestedTag !== `v${pkg.version}`) {
  fail(`tag ${requestedTag} không khớp package v${pkg.version}`)
}

const macTargets = Array.isArray(builder?.mac?.target) ? builder.mac.target : []
const targetNames = macTargets.map((entry) => (typeof entry === 'string' ? entry : entry?.target))
if (!targetNames.includes('dmg') || !targetNames.includes('zip')) {
  fail('macOS phải tạo cả DMG và ZIP cho cài đặt/tự cập nhật')
}
for (const entry of macTargets) {
  if (typeof entry === 'object' && !entry?.arch?.includes('arm64')) {
    fail(`target macOS ${entry?.target || '(không rõ)'} chưa khóa ARM64`)
  }
}
if (builder?.mac?.notarize !== true || builder?.mac?.hardenedRuntime !== true) {
  fail('macOS phải bật hardened runtime và notarization')
}
if (!String(builder?.mac?.artifactName || '').includes('${arch}')) {
  fail('tên artifact macOS phải chứa kiến trúc')
}

console.log(`Release metadata OK: v${pkg.version}${requestedTag ? ` (${requestedTag})` : ''}`)
