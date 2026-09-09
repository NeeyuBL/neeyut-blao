import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ASSET_BASE, binDir, extractZip } from '../src/main/deps'
import { installOcrEngine, ocrEngineStatus, ocrInstallErrorMessage } from '../src/main/ocr'
import { clearLogs, getLogs } from '../src/main/logger'

const testRoot = process.env.TBLAO_OCR_SMOKE_ROOT
assert.ok(testRoot, 'Use scripts/run-ocr-install-smoke.mjs to isolate all writes.')
const root = testRoot!
const online = process.argv.includes('--online')
const originalFetch = globalThis.fetch
const cpuAsset = 'ocr-engine-win-cpu.zip'
const dmlAsset = 'ocr-engine-win-directml.zip'
const hashManifest = `${ASSET_BASE}/ocr-engines-sha256.json`
const versionsManifest = `${ASSET_BASE}/engines-manifest.json`
let passed = 0

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function createFixture(provider: 'cpu' | 'directml'): Promise<Buffer> {
  const folder = join(root, `fixture-${provider}`, `ocr-engine-${provider}`)
  await mkdir(folder, { recursive: true })
  // Intentionally not an executable: extraction must succeed and the actual
  // process launch/self-test must fail. No subprocess/extraction mocking.
  await writeFile(join(folder, 'ocr-engine.exe'), 'not a Windows executable\n')
  await writeFile(join(folder, 'fixture.txt'), 'verified extraction\n')
  const zip = join(root, `fixture-${provider}.zip`)
  const result = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath ${quotePs(folder)} -DestinationPath ${quotePs(zip)}`
  ], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr || String(result.error || 'Cannot create test ZIP'))
  return readFile(zip)
}

async function freshCase(): Promise<void> {
  // Spaces, Vietnamese text, $, apostrophe and [] are real Windows user-path
  // cases and catch unsafe PowerShell string interpolation as well.
  process.env.TBLAO_OCR_SMOKE_USERDATA = join(root, `Tiếng Việt $OCR [test] O'Brien`, `case-${passed + 1}`)
  await mkdir(binDir(), { recursive: true })
  clearLogs()
}

function fixtureFetch(
  assets: Record<string, Buffer>,
  checksumOverrides: Record<string, string> = {}
): string[] {
  const requested: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    assert.equal(new Headers(init?.headers).has('Authorization'), false, 'User downloads must be public')
    requested.push(url)
    if (url === hashManifest) {
      return Response.json({ ...Object.fromEntries(Object.entries(assets).map(([name, bytes]) => [name, sha256(bytes)])), ...checksumOverrides })
    }
    if (url === versionsManifest) return Response.json({ ocr: 4 })
    const name = url.slice(`${ASSET_BASE}/`.length)
    if (url.startsWith(`${ASSET_BASE}/`) && assets[name]) {
      const bytes = assets[name]
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })
    }
    throw new Error(`Unexpected network request in offline test: ${url}`)
  }
  return requested
}

async function seedPreviousCpu(): Promise<void> {
  await mkdir(join(binDir(), 'ocr-engine-cpu'), { recursive: true })
  await writeFile(join(binDir(), 'ocr-engine-cpu', 'previous-engine.txt'), 'keep old installation')
  await writeFile(join(binDir(), 'engines-local.json'), '{"ocr":3}')
}

async function assertPreviousCpuPreserved(): Promise<void> {
  assert.equal(await readFile(join(binDir(), 'ocr-engine-cpu', 'previous-engine.txt'), 'utf8'), 'keep old installation')
  assert.equal(await exists(join(binDir(), 'ocr-engine-cpu', 'fixture.txt')), false)
  assert.deepEqual(JSON.parse(await readFile(join(binDir(), 'engines-local.json'), 'utf8')), { ocr: 3 })
  await assertNoTemporaryFiles()
}

async function assertNoTemporaryFiles(): Promise<void> {
  const entries = await readdir(binDir())
  assert.deepEqual(entries.filter((name) => /\.download(?:\.zip)?$|\.backup$/i.test(name)), [])
}

async function test(name: string, callback: () => Promise<void>): Promise<void> {
  await freshCase()
  try {
    await callback()
    passed += 1
    console.log(`PASS ${name}`)
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function main(): Promise<void> {
  const cpuFixture = await createFixture('cpu')
  const dmlFixture = await createFixture('directml')

  await test('Windows ZIP extraction with international and special-character paths', async () => {
    const zip = join(binDir(), 'archive.download.zip')
    await writeFile(zip, cpuFixture)
    await extractZip(zip, binDir())
    assert.equal(await readFile(join(binDir(), 'ocr-engine-cpu', 'fixture.txt'), 'utf8'), 'verified extraction\n')
  })

  await test('Network failures are categorized without leaking private error details', async () => {
    await seedPreviousCpu()
    const privateDetails = `${binDir()} https://example.test/private?token=ocr-test-secret`
    globalThis.fetch = async () => {
      throw new TypeError(`fetch failed: ${privateDetails}`, {
        cause: Object.assign(new Error(`connection reset: ${privateDetails}`), { code: 'ECONNRESET' })
      })
    }
    await assert.rejects(installOcrEngine('cpu', () => {}), (error) => {
      const message = ocrInstallErrorMessage(error)
      assert.match(message, /Không tải được/)
      assert.match(message, /lỗi kết nối mạng/)
      assert.ok(!message.includes('ocr-test-secret') && !message.includes(binDir()))
      return true
    })
    const logs = getLogs().map(({ msg }) => msg).join('\n')
    assert.match(logs, /stage=download, code=ECONNRESET/)
    assert.ok(!logs.includes('ocr-test-secret') && !logs.includes(binDir()))
    await assertPreviousCpuPreserved()
  })

  await test('Checksum failure preserves the previous engine before extraction', async () => {
    fixtureFetch({ [cpuAsset]: cpuFixture }, { [cpuAsset]: '0'.repeat(64) })
    await seedPreviousCpu()
    await assert.rejects(installOcrEngine('cpu', () => {}))
    assert.ok(getLogs().some(({ msg }) => /stage=checksum.*OCR_CHECKSUM_MISMATCH/.test(msg)))
    await assertPreviousCpuPreserved()
  })

  await test('Broken ZIP rolls back the previous engine', async () => {
    fixtureFetch({ [cpuAsset]: Buffer.from('not a zip file') })
    await seedPreviousCpu()
    await assert.rejects(installOcrEngine('cpu', () => {}))
    assert.ok(getLogs().some(({ msg }) => /stage=extract/.test(msg)))
    await assertPreviousCpuPreserved()
  })

  await test('Real extraction reaches self-test and rolls back a broken executable', async () => {
    fixtureFetch({ [cpuAsset]: cpuFixture })
    await seedPreviousCpu()
    await assert.rejects(installOcrEngine('cpu', () => {}))
    // Before the fix, .zip.download fails in Expand-Archive so self-test is
    // never reached. The stage is emitted by the production installer.
    assert.ok(getLogs().some(({ msg }) => /self-test|tự kiểm tra|kiểm tra hoạt động/i.test(msg)), 'Installer never reached self-test; inspect the downloaded ZIP filename')
    await assertPreviousCpuPreserved()
  })

  await test('Auto mode tries CPU after DirectML installation fails', async () => {
    const requested = fixtureFetch({ [dmlAsset]: dmlFixture, [cpuAsset]: cpuFixture }, {
      [dmlAsset]: '0'.repeat(64), [cpuAsset]: '0'.repeat(64)
    })
    await assert.rejects(installOcrEngine('auto', () => {}))
    assert.deepEqual(requested.filter((url) => url.endsWith('.zip')), [`${ASSET_BASE}/${dmlAsset}`, `${ASSET_BASE}/${cpuAsset}`])
    await assertNoTemporaryFiles()
  })

  await test('Concurrent installation is shared and a failed attempt can be retried', async () => {
    const requested = fixtureFetch({ [cpuAsset]: cpuFixture }, { [cpuAsset]: '0'.repeat(64) })
    const results = await Promise.allSettled([
      installOcrEngine('cpu', () => {}),
      installOcrEngine('cpu', () => {})
    ])
    assert.ok(results.every((result) => result.status === 'rejected'))
    assert.equal(requested.filter((url) => url === `${ASSET_BASE}/${cpuAsset}`).length, 1, 'Concurrent callers downloaded into the same temporary path')
    await assert.rejects(installOcrEngine('cpu', () => {}))
    assert.equal(requested.filter((url) => url === `${ASSET_BASE}/${cpuAsset}`).length, 2, 'Failure left a stale in-flight installation')
    await assertNoTemporaryFiles()
  })

  if (online) {
    await test('Public CPU clean install and real inference after DirectML self-test failure', async () => {
      const before = await ocrEngineStatus(true)
      assert.equal(before.has, false)
      assert.equal(before.activeProvider, null)
      const publicUrls = new Set<string>()
      globalThis.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        const headers = new Headers(init?.headers)
        assert.equal(headers.has('Authorization'), false, 'Public asset download unexpectedly requires authorization')
        if (url === `${ASSET_BASE}/${dmlAsset}`) {
          return new Response(dmlFixture, { headers: { 'Content-Length': String(dmlFixture.length) } })
        }
        assert.ok(url.startsWith(`${ASSET_BASE}/`), `Unexpected public request: ${url}`)
        publicUrls.add(url)
        const response = await originalFetch(input, init)
        assert.ok(response.ok, `Public asset returned HTTP ${response.status}: ${url}`)
        if (url === hashManifest) {
          const hashes = await response.json()
          return Response.json({ ...hashes, [dmlAsset]: sha256(dmlFixture) })
        }
        return response
      }
      let lastBucket = -1
      const installed = await installOcrEngine('auto', (percent) => {
        const bucket = Math.floor(percent / 20)
        if (bucket !== lastBucket) {
          lastBucket = bucket
          console.log(`Download progress: ${percent}%`)
        }
      })
      assert.equal(installed.activeProvider, 'cpu')
      assert.equal(installed.gpuRequired, false)
      const cpu = installed.providers.find((provider) => provider.provider === 'cpu')!
      assert.equal(cpu.ready, true)
      assert.equal(cpu.executionProvider, 'CPUExecutionProvider')
      assert.ok(['det', 'cls', 'rec'].every((model) => Boolean(cpu.models[model])))
      assert.ok(publicUrls.has(`${ASSET_BASE}/${cpuAsset}`), 'CPU archive did not use the real public download')
      assert.ok(publicUrls.has(hashManifest), 'Public SHA256 manifest was not verified')
      assert.ok(publicUrls.has(versionsManifest), 'Engine version manifest was not checked')
      assert.ok(Number(JSON.parse(await readFile(join(binDir(), 'engines-local.json'), 'utf8')).ocr) > 0)
      assert.equal(await exists(join(binDir(), 'ocr-engine-directml')), false, 'Failed DirectML install was not cleaned up')
      await assertNoTemporaryFiles()
      console.log(`Real CPU inference passed: ${cpu.inferenceMs ?? '?'} ms; detection, classification and recognition models ready.`)
    })
  } else {
    console.log('Public asset install skipped; add --online to download and self-test the real CPU engine.')
  }
  console.log(`OCR installer smoke passed: ${passed} scenarios.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  globalThis.fetch = originalFetch
})
