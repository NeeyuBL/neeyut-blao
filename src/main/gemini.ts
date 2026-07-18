import { safeStorage } from 'electron'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { debugRaw, errLabel, logInfo } from './logger'
import { DICH_LANGS, type GeminiStatus, type SrtBlock } from '../shared/types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

// ---- Khoa cua user: ma hoa bang DPAPI (Win) / Keychain (mac) ----
function keyFile(): string {
  return join(app.getPath('userData'), 'gk.bin')
}

export async function saveKey(key: string): Promise<void> {
  const t = key.trim()
  if (!t) {
    await rm(keyFile(), { force: true })
    return
  }
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(t)
    : Buffer.from(t, 'utf-8')
  await writeFile(keyFile(), buf)
}

export async function loadKey(): Promise<string> {
  try {
    const buf = await readFile(keyFile())
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
  } catch {
    return ''
  }
}

export async function hasKey(): Promise<boolean> {
  return (await loadKey()).length > 0
}

// ---- Chon model ----
const DU_PHONG = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite']
const LOAI = /image|imagen|tts|audio|speech|embedding|robotics|computer-use|omni/

function diem(n: string): number {
  const m = n.match(/(\d+\.\d+|\d+)/)
  let s = (m ? parseFloat(m[1]) : 1) * 100
  if (n.includes('flash')) s += 50
  if (n.includes('lite')) s -= 20
  if (n.includes('preview') || n.includes('-exp')) s -= 30
  return s
}

async function danhSach(key: string): Promise<string[]> {
  let ds: string[] = []
  try {
    // Cung phai co han: mat mang o day thi treo truoc khi kip goi dich.
    const res = await fetch(`${BASE}/models?key=${key}`, { signal: AbortSignal.timeout(15_000) })
    if (res.ok) {
      const d = (await res.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[]
      }
      ds = (d.models ?? [])
        .filter(
          (m) =>
            (m.name ?? '').includes('gemini-') &&
            (m.supportedGenerationMethods ?? []).includes('generateContent')
        )
        .map((m) => (m.name as string).replace('models/', ''))
    }
  } catch {
    /* rot ve du phong */
  }
  const pool = ds.length ? ds : DU_PHONG
  return pool.filter((n) => !LOAI.test(n)).sort((a, b) => diem(b) - diem(a))
}

interface GenKQ {
  ok: boolean
  text?: string
  lui?: boolean
  status?: number
  err?: string
}

// fetch cua Node KHONG tu het gio. Google mo ket noi roi im -> cho VINH VIEN,
// nut quay mai, khong co duong thoat. Bat buoc phai tu dat han.
const HAN_KIEM = 20_000 // kiem key: 1 cau "xin chào", 20s la qua du
const HAN_DICH = 180_000 // dich 1 chunk 20k ky tu: do that 14-60s

async function goi(
  key: string,
  model: string,
  sys: string,
  user: string,
  schema?: object,
  han = HAN_DICH
): Promise<GenKQ> {
  const cfg: Record<string, unknown> = { temperature: 0.2 }
  if (schema) {
    cfg.responseMimeType = 'application/json'
    cfg.responseSchema = schema
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: cfg
  }
  if (sys) body.systemInstruction = { parts: [{ text: sys }] }
  let res: Response
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(han)
    })
  } catch (e) {
    return { ok: false, lui: true, status: 0, err: String(e) }
  }
  if (!res.ok) {
    const t = await res.text()
    return { ok: false, lui: res.status === 429 || res.status >= 500, status: res.status, err: t }
  }
  const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) return { ok: false, lui: false, status: 200, err: 'rỗng' }
  return { ok: true, text }
}

async function goiCoLui(
  key: string,
  models: string[],
  sys: string,
  user: string,
  schema?: object,
  han?: number
): Promise<GenKQ> {
  // Khong co model nao de thu -> phai bao ro, dung de rot ve "lỗi không xác định"
  if (!models.length) return { ok: false, err: 'network: không lấy được danh sách' }
  let cuoi: GenKQ = { ok: false, err: 'hết model' }
  for (const m of models) {
    const r = await goi(key, m, sys, user, schema, han)
    if (r.ok) return r
    debugRaw(`gemini ${m}`, r.err)
    cuoi = r
    if (!r.lui) break
  }
  return cuoi
}

/**
 * Kiem tra khoa = gui MOT cau chao that don gian, co tra loi la khoa con song.
 * Khong system instruction, khong schema — cang it thu cang it cho hong.
 * UI chi duoc bao dung/khong: khong ten model, khong so lieu.
 */
export async function checkKey(key: string): Promise<GeminiStatus> {
  const k = key.trim() || (await loadKey())
  if (!k) return { ok: false, message: 'Chưa nhập API key.' }

  const models = await danhSach(k)
  if (!models.length) return { ok: false, message: 'Kiểm tra thất bại: lỗi kết nối mạng.' }

  // Co mang thi Google LUON tra loi — chi la tra bang loi. Nen ket luan "khoa
  // chet" chi duoc rut ra khi da di HET danh sach ma khong cai nao tra loi.
  // (Truoc day chi thu 5 -> 5 cai dau ket hạn la bao chet, trong khi nhung cai
  //  sau van song -> bao oan.)
  let ketHan = 0
  let loiKhac = ''
  for (const m of models) {
    const r = await goi(k, m, '', 'xin chào', undefined, HAN_KIEM)
    if (r.ok) return { ok: true, message: 'API KEY của bạn dùng được.' }
    debugRaw(`checkKey ${m}`, r.err)

    // Mat mang / het gio -> dung ngay, thu tiep cung vo ich
    if (r.status === 0) return { ok: false, message: `Kiểm tra thất bại: ${errLabel(r.err)}` }
    // Khoa sai/bi thu hoi -> chac chan chet, khong can thu tiep
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      return { ok: false, message: 'API KEY không dùng được. Vui lòng tạo khoá mới và dán lại.' }
    }
    if (r.status === 429) ketHan++
    else loiKhac = r.err ?? ''
  }

  // Di het danh sach, khong cai nao tra loi
  if (ketHan && !loiKhac) {
    return { ok: false, message: 'API KEY đã dùng hết lượt hôm nay. Vui lòng thử lại sau.' }
  }
  return { ok: false, message: `API KEY không dùng được: ${errLabel(loiKhac)}` }
}

// ---- Dich .srt ----
const MAX_CHARS = 20000

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { n: { type: 'INTEGER' }, t: { type: 'STRING' } },
    required: ['n', 't']
  }
}

function huongDan(ma: string): string {
  // Nhan vao la MA ngon ngu (dung dat ten file). Doi sang TEN de bao cho AI.
  const ten = DICH_LANGS.find((l) => l.code === ma)?.label ?? ma
  return [
    `Bạn là một dịch giả chuyên nghiệp. Hãy dịch phụ đề được cung cấp sang ${ten}.`,
    '',
    'Yêu cầu bắt buộc:',
    '1. Mỗi phần tử trả về: n = đúng số thứ tự dòng gốc, t = bản dịch của dòng đó.',
    '2. Trả về ĐÚNG số dòng đã nhận. KHÔNG gộp hai dòng, KHÔNG tách một dòng thành hai.',
    '3. Một dòng gốc có thể là câu chưa trọn nghĩa (phụ đề cắt theo khoảng lặng). Giữ nguyên',
    '   ranh giới dòng, dùng các dòng xung quanh làm ngữ cảnh để dịch cho đúng.',
    '4. Giữ nguyên các nhãn dạng [SPEAKER_00] ở đúng vị trí cũ, không dịch, không xoá.',
    '5. Dịch sát nghĩa, tự nhiên, đúng văn phong gốc. Không thêm bớt, không giải thích.'
  ].join('\n')
}

/** Gom khoi toi sat nguong. Ranh gioi LUON giua 2 khoi -> moc thoi gian an toan. */
function chia(blocks: SrtBlock[]): SrtBlock[][] {
  const out: SrtBlock[][] = []
  let cur: SrtBlock[] = []
  let len = 0
  for (const b of blocks) {
    const cost = b.text.length + 5
    if (cur.length && len + cost > MAX_CHARS) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(b)
    len += cost
  }
  if (cur.length) out.push(cur)
  return out
}

export function parseSrt(raw: string): SrtBlock[] {
  return raw
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((b) => {
      const lines = b.split('\n')
      const i = lines.findIndex((l) => l.includes('-->'))
      if (i < 0) return null
      return { time: lines[i].trim(), text: lines.slice(i + 1).join(' ').trim() }
    })
    .filter((b): b is SrtBlock => !!b && !!b.text)
}

export function buildSrt(blocks: SrtBlock[]): string {
  return blocks.map((b, i) => `${i + 1}\n${b.time}\n${b.text}`).join('\n\n') + '\n'
}

/**
 * Dich 1 file .srt. Timestamp KHONG bao gio gui di — giu o may, ghep lai sau.
 * Khoi nao khong co ban dich -> giu nguyen chu goc (tha 1 dong chua dich con
 * hon ca file sai gio).
 */
export async function translateSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8'))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const models = await danhSach(key)
  const chunks = chia(blocks)
  logInfo(`Dịch phụ đề: ${blocks.length} câu…`)

  const ra: SrtBlock[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const payload = c.map((b, j) => `${j + 1}. ${b.text}`).join('\n')
    const r = await goiCoLui(key, models, huongDan(dich), payload, SCHEMA)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    let arr: { n: number; t: string }[] = []
    try {
      arr = JSON.parse(r.text as string)
    } catch {
      return { ok: false, error: 'Kết quả dịch không đọc được.' }
    }
    const map = new Map(arr.map((x) => [x.n, x.t]))
    c.forEach((b, j) => ra.push({ time: b.time, text: map.get(j + 1) || b.text }))
    onProgress?.(i + 1, chunks.length)
  }

  await writeFile(outPath, buildSrt(ra), 'utf-8')
  logInfo(`Dịch phụ đề: xong ${ra.length} câu.`)
  return { ok: true, count: ra.length }
}
