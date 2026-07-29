import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ASSET_BASE, binDir } from './deps'
import { debugRaw, logInfo } from './logger'

/** Ten key trong engines-manifest.json tren assets-v1. */
export type EngineKind = 'ocr' | 'whisper' | 'douyin' | 'whisperCuda' | 'video2x'

type VerMap = Partial<Record<EngineKind, number>>

const MANIFEST_URL = `${ASSET_BASE}/engines-manifest.json`

function localPath(): string {
  return join(binDir(), 'engines-local.json')
}

async function readLocal(): Promise<VerMap> {
  try {
    const raw = await readFile(localPath(), 'utf-8')
    return JSON.parse(raw) as VerMap
  } catch {
    return {}
  }
}

async function writeLocal(map: VerMap): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  await writeFile(localPath(), JSON.stringify(map, null, 2), 'utf-8')
}

/** Lay bang version tu GitHub. Loi mang -> null (khong chan app). */
export async function fetchRemoteManifest(): Promise<VerMap | null> {
  try {
    const res = await fetch(MANIFEST_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    return (await res.json()) as VerMap
  } catch (e) {
    debugRaw('engines-manifest', e)
    return null
  }
}

/**
 * Engine da cai ma local version < remote -> can tai lai.
 * Chua co file local -> coi la 0 (user cu se duoc cap nhat lan dau).
 */
export async function engineNeedsUpdate(kind: EngineKind, installed: boolean): Promise<boolean> {
  if (!installed) return false
  const remote = await fetchRemoteManifest()
  if (!remote) return false
  const want = Number(remote[kind] ?? 0)
  if (!want) return false
  const local = await readLocal()
  const have = Number(local[kind] ?? 0)
  return have < want
}

/** Sau khi cai/update thanh cong: ghi local = remote (hoac 1 neu khong doc duoc manifest). */
export async function markEngineInstalled(kind: EngineKind): Promise<void> {
  const remote = await fetchRemoteManifest()
  const local = await readLocal()
  const ver = Number(remote?.[kind] ?? local[kind] ?? 1) || 1
  local[kind] = ver
  await writeLocal(local)
  logInfo(`Công cụ ${kind}: đã ghi phiên bản ${ver}.`)
}
