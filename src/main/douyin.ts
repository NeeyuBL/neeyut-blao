import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { binDir, downloadFile } from './deps'
import { readDyCookies } from './douyinCookies'
import { logError, logInfo } from './logger'
import { DouyinProgress, DouyinRequest, DouyinResult, DyChannel, DyEngineStatus } from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

// TODO: thay bang URL Release that khi phat hanh engine (Buoc phat hanh).
// Moi OS 1 file: dy-engine.exe (Windows) / dy-engine-macos (macOS) — dong goi rieng tren tung may.
const DY_ENGINE_BASE = 'https://github.com/NeeyuBL/t-blao/releases/latest/download'
function engineAsset(): string {
  return isWin ? 'dy-engine.exe' : isMac ? 'dy-engine-macos' : 'dy-engine-linux'
}
function engineUrl(): string {
  return `${DY_ENGINE_BASE}/${engineAsset()}`
}

function engineName(): string {
  return isWin ? 'dy-engine.exe' : 'dy-engine'
}
function enginePath(): string {
  return join(binDir(), engineName())
}
function libraryDbPath(): string {
  return join(app.getPath('userData'), 'dy-library.db')
}
function configPath(): string {
  return join(app.getPath('userData'), 'dy-config.yml')
}
function channelsPath(): string {
  return join(app.getPath('userData'), 'dy-channels.json')
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function dyEngineStatus(): Promise<DyEngineStatus> {
  return { has: await fileExists(enginePath()) }
}

export async function installDyEngine(onProgress: (percent: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  logInfo('Douyin: đang tải bộ tải Douyin…')
  await downloadFile(engineUrl(), enginePath(), onProgress)
  if (!isWin) await chmod(enginePath(), 0o755)
  logInfo('Douyin: đã tải xong bộ tải Douyin.')
}

/** Dung config (object) tu yeu cau + cookie. Ghi JSON (la YAML hop le). */
function buildConfig(req: DouyinRequest, cookies: Record<string, string>): object {
  const number = { post: 0, like: 0, allmix: 0, mix: 0, music: 0, collect: 0, collectmix: 0 }
  const increase = { post: false, like: false, allmix: false, mix: false, music: false }

  if (req.isChannel) {
    if (req.mode === 'batch') number.post = Math.max(1, req.batchSize || 15)
    else if (req.mode === 'new') increase.post = true
    // 'all' -> number.post = 0, increase.post = false (tai het, chay lai tu tai tiep nho DB)
  }

  const outPath = req.outputDir.replace(/\\/g, '/').replace(/\/?$/, '/')

  return {
    link: [req.url],
    path: outPath,
    music: req.music,
    cover: req.cover,
    avatar: req.avatar,
    json: req.metaJson,
    folderstyle: true,
    mode: ['post'],
    number,
    increase,
    thread: 5,
    retry_times: 3,
    proxy: req.proxy || '',
    database: true,
    database_path: libraryDbPath().replace(/\\/g, '/'),
    browser_fallback: { enabled: false },
    progress: { quiet_logs: true },
    cookies
  }
}

async function writeConfig(req: DouyinRequest, cookies: Record<string, string>): Promise<string> {
  const p = configPath()
  await writeFile(p, JSON.stringify(buildConfig(req, cookies), null, 2), 'utf-8')
  return p
}

/** Tai Douyin: spawn engine, doc stdout+stderr, parse tien do + tong ket. */
export async function downloadDouyin(
  id: string,
  req: DouyinRequest,
  onProgress: (p: DouyinProgress) => void
): Promise<DouyinResult> {
  const engine = enginePath()
  if (!(await fileExists(engine))) {
    return {
      id,
      ok: false,
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      error: 'Chưa có bộ tải Douyin. Vui lòng tải công cụ Douyin trước.'
    }
  }

  const cookies = await readDyCookies()
  const cfgPath = await writeConfig(req, cookies)
  logInfo(`Douyin: bắt đầu tải ${req.url} (kiểu: ${req.mode})`)

  return new Promise<DouyinResult>((resolve) => {
    const child = spawn(engine, ['-c', cfgPath, '--verbose'], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    })

    let success = 0
    let total = 0
    let failed = 0
    let skipped = 0
    let lastFile: string | null = null
    let outBuf = ''
    let errBuf = ''
    let errTail = ''

    onProgress({ id, status: 'preparing', line: 'Bắt đầu…', lastFile: null, success: 0 })

    const num = (v: string): number => {
      const n = Number(v)
      return isFinite(n) ? n : 0
    }

    const handleLine = (line: string): void => {
      const t = line.trim()
      if (!t) return

      // Video vua tai xong (log: "Downloaded video: TITLE (id)")
      const mDl = t.match(/Downloaded (?:video|image|媒体)?:?\s*(.+?)\s*\(\d+\)\s*$/i)
      if (mDl) {
        success++
        lastFile = mDl[1]
        onProgress({ id, status: 'downloading', line: t, lastFile, success })
        return
      }

      // Bang tong ket (rich): "│ Total │ 2 │" ...
      const mTotal = t.match(/Total\s*[│|]\s*(\d+)/i)
      if (mTotal) total = num(mTotal[1])
      const mSucc = t.match(/Success\s*[│|]\s*(\d+)/i)
      if (mSucc) success = num(mSucc[1])
      const mFail = t.match(/Failed\s*[│|]\s*(\d+)/i)
      if (mFail) failed = num(mFail[1])
      const mSkip = t.match(/Skipped\s*[│|]\s*(\d+)/i)
      if (mSkip) skipped = num(mSkip[1])

      // Loi ERROR -> giu lai vai dong cuoi de bao
      if (/ERROR|Traceback|Exception/i.test(t)) errTail = t
    }

    const feed = (chunk: string, isErr: boolean): void => {
      if (isErr) errBuf += chunk
      let buf = isErr ? errBuf : outBuf
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      if (isErr) errBuf = buf
      else outBuf = buf
      for (const l of parts) handleLine(l)
    }

    child.stdout.on('data', (d) => feed(d.toString(), false))
    child.stderr.on('data', (d) => feed(d.toString(), true))

    child.on('error', (err) => {
      logError(`Douyin: không chạy được engine: ${err.message}`)
      resolve({ id, ok: false, total, success, failed, skipped, error: err.message })
    })

    child.on('close', (code) => {
      if (outBuf) handleLine(outBuf)
      if (errBuf) handleLine(errBuf)
      if (code === 0) {
        logInfo(`Douyin: hoàn tất — thành công ${success}/${total || success}`)
        onProgress({ id, status: 'finished', line: null, lastFile, success })
        if (req.isChannel) void recordChannel(req.url, req.outputDir, success)
        resolve({ id, ok: true, total: total || success, success, failed, skipped, error: null })
      } else {
        const err = errTail || errBuf.trim().split(/\r?\n/).slice(-2).join(' ') || `Thoát mã ${code}`
        logError(`Douyin: lỗi tải — ${err.slice(0, 400)}`)
        onProgress({ id, status: 'error', line: err, lastFile, success })
        resolve({ id, ok: false, total, success, failed, skipped, error: err.slice(0, 400) })
      }
    })
  })
}

// ---- Thu vien kenh ----
export async function getChannels(): Promise<DyChannel[]> {
  try {
    const list = JSON.parse(await readFile(channelsPath(), 'utf-8')) as DyChannel[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function saveChannels(list: DyChannel[]): Promise<void> {
  await writeFile(channelsPath(), JSON.stringify(list, null, 2), 'utf-8')
}

/** Doc ten kenh (author_name) tu manifest cua lan tai. */
async function channelNameFromManifest(outputDir: string): Promise<string | null> {
  try {
    const text = await readFile(join(outputDir, 'download_manifest.jsonl'), 'utf-8')
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const rec = JSON.parse(lines[i]) as { author_name?: string }
        if (rec.author_name) return rec.author_name
      } catch {
        /* bo qua dong hong */
      }
    }
  } catch {
    /* khong co manifest */
  }
  return null
}

async function recordChannel(url: string, outputDir: string, added: number): Promise<void> {
  const list = await getChannels()
  const name = (await channelNameFromManifest(outputDir)) ?? 'Kênh Douyin'
  const now = new Date().toISOString()
  const existing = list.find((c) => c.url === url)
  if (existing) {
    existing.name = name || existing.name
    existing.lastRun = now
    existing.count += added
  } else {
    list.unshift({ url, name, lastRun: now, count: added })
  }
  await saveChannels(list)
}

export async function removeChannel(url: string): Promise<DyChannel[]> {
  const list = (await getChannels()).filter((c) => c.url !== url)
  await saveChannels(list)
  return list
}
