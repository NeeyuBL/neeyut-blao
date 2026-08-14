import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveFfmpeg } from './deps'
import { debugRaw } from './logger'

export interface AudioPreviewResult {
  ok: boolean
  path?: string
  error?: string
}

const inFlight = new Map<string, Promise<AudioPreviewResult>>()

async function transcodeAudioPreview(input: string): Promise<AudioPreviewResult> {
  if (!isAbsolute(input)) return { ok: false, error: 'Đường dẫn tệp lồng tiếng không hợp lệ.' }
  const source = await stat(input)
  if (!source.isFile() || source.size <= 0) {
    return { ok: false, error: 'Tệp lồng tiếng không có dữ liệu.' }
  }
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) return { ok: false, error: 'Chưa tìm thấy FFmpeg để chuẩn bị bản nghe thử.' }

  const cacheDir = join(tmpdir(), 'tblao-audio-preview')
  await mkdir(cacheDir, { recursive: true })
  const key = createHash('sha256')
    .update(input)
    .update(String(source.size))
    .update(String(source.mtimeMs))
    .digest('hex')
    .slice(0, 24)
  const output = join(cacheDir, `${key}.m4a`)
  try {
    const existing = await stat(output)
    if (existing.isFile() && existing.size > 0) return { ok: true, path: output }
  } catch {
    // Chua co cache.
  }

  return new Promise((resolve) => {
    const temporaryOutput = join(cacheDir, `${key}.${randomUUID()}.tmp.m4a`)
    const child = spawn(
      ffmpeg,
      ['-y', '-v', 'error', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', temporaryOutput],
      { windowsHide: true }
    )
    let stderr = ''
    let settled = false
    const finish = (result: AudioPreviewResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString()
    })
    child.on('error', (error) => {
      debugRaw('audio preview transcode', error)
      void rm(temporaryOutput, { force: true }).catch(() => undefined)
      finish({ ok: false, error: 'Không thể chuẩn bị bản nghe thử cho tệp này.' })
    })
    child.on('close', async (code) => {
      if (settled) return
      if (code !== 0) {
        debugRaw('audio preview transcode', stderr)
        await rm(temporaryOutput, { force: true }).catch(() => undefined)
        finish({ ok: false, error: 'FFmpeg không thể đọc tệp lồng tiếng này.' })
        return
      }
      try {
        const result = await stat(temporaryOutput)
        if (result.isFile() && result.size > 0) await rename(temporaryOutput, output)
        finish(
          result.isFile() && result.size > 0
            ? { ok: true, path: output }
            : { ok: false, error: 'Bản nghe thử được tạo ra không hợp lệ.' }
        )
      } catch (error) {
        debugRaw('audio preview stat', error)
        await rm(temporaryOutput, { force: true }).catch(() => undefined)
        finish({ ok: false, error: 'Không thể hoàn tất bản nghe thử.' })
      }
    })
  })
}

export async function prepareAudioPreview(input: string): Promise<AudioPreviewResult> {
  const current = inFlight.get(input)
  if (current) return current
  const task = transcodeAudioPreview(input).finally(() => inFlight.delete(input))
  inFlight.set(input, task)
  return task
}
