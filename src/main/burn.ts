import { spawn, type ChildProcess } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { mkdir, copyFile, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logInfo } from './logger'
import type { BlurRegion, BurnReq, BurnProgress, BurnResult } from '../shared/types'

let child: ChildProcess | null = null
let daHuy = false

/** Huy giua chung: giet ffmpeg. child.kill() thoat ma null -> hieu la huy, khong loi. */
export function cancelBurn(): void {
  daHuy = true
  if (!child) return
  try {
    child.kill()
  } catch {
    /* bo qua */
  }
  child = null
}

function duongFfprobe(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

interface Meta {
  w: number
  h: number
  giay: number
  hasAudio: boolean
}

/** Lay kich thuoc + thoi luong video (de tinh co chu, le, phan tram tien do). */
async function doVideo(ffprobe: string, video: string): Promise<Meta> {
  return new Promise((resolve) => {
    const p = spawn(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,width,height',
        '-show_entries', 'format=duration',
        '-of', 'default=nw=1',
        video
      ],
      { windowsHide: true }
    )
    let out = ''
    p.stdout.on('data', (d: Buffer) => (out += d.toString()))
    p.on('close', () => {
      resolve({
        w: Number(/width=(\d+)/.exec(out)?.[1]) || 0,
        h: Number(/height=(\d+)/.exec(out)?.[1]) || 0,
        giay: Number(/duration=([\d.]+)/.exec(out)?.[1]) || 0,
        hasAudio: out.includes('codec_type=audio')
      })
    })
    p.on('error', () => resolve({ w: 0, h: 0, giay: 0, hasAudio: false }))
  })
}

interface BoCuc {
  che: boolean // co che phu de goc khong
  y: number // mep tren dai che (pixel)
  bh: number // chieu cao dai che
  x: number // mep trai dai che (pixel)
  bw: number // chieu rong dai che
  sigma: number // do manh blur (gaussian)
  fontSize: number // co chu (PIXEL VIDEO — nho .ass co PlayResY = chieu cao video)
  vien: number // do day vien
  marginV: number // le duoi (pixel video)
  tamY: number | null // null = khong co khung sub (user khong keo) => dung marginV mac dinh
}

/**
 * Bo tham so bo cuc — video NGANG va DOC dung 2 bo KHAC NHAU.
 * Vi sao phai tach: video doc (9:16) co chieu cao rat lon nhung khung hep, ma
 * thang co chu lai tinh theo chieu cao -> 3.5%/4.5%/5.5% cua 1920 deu vuot xa
 * muc be rong cho phep, bi chan het ve cung MOT so (user doi Vua/Lon/Rat lon ma
 * chu khong nhuc nhich). Voi video doc phai lay moc theo BE RONG.
 */
interface ThamSo {
  theoCao: boolean // moc tinh co chu: chieu cao (ngang) hay be rong (doc)
  tuDong: number // co chu tu dong khi KHONG co khung mo
  thang: Record<'nho' | 'vua' | 'lon' | 'ratlon', number>
  min: number
  max: number
  le: number // le trai/phai (ti le be rong)
}
// Ngang: GIU NGUYEN so cu (dang chay tot, khong dung vao).
const NGANG: ThamSo = {
  theoCao: true,
  tuDong: 0.042,
  thang: { nho: 0.025, vua: 0.035, lon: 0.045, ratlon: 0.055 },
  min: 0.02,
  max: 0.055,
  le: 0.04
}
// Doc: moc theo be rong, chu to hon va cho phep 2-3 dong (kieu TikTok/Reels).
// Thang trai deu tu min den max nen khong con canh 3 muc ra cung mot co.
const DOC: ThamSo = {
  theoCao: false,
  tuDong: 0.045,
  thang: { nho: 0.035, vua: 0.045, lon: 0.055, ratlon: 0.065 },
  min: 0.035,
  max: 0.065,
  le: 0.05
}

/**
 * Tinh bo cuc dot chu tu kich thuoc video + dai chu goc.
 * Che phu de goc kieu BLUR (kinh mo, giong CapCut) — do that dep hon thanh den
 * cung. Huong video (ngang/doc) lay tu ffprobe -> chon bo tham so tuong ung.
 * Dai mo giu DUNG khung user keo; chu can giua quanh tam dai do va duoc phep
 * tran ra ngoai.
 */
export function boCuc(
  meta: Meta,
  subRegion?: { x0: number; y0: number; x1: number; y1: number } | null,
  lamMo?: boolean
): BoCuc {
  const co = meta.h > 0 ? meta.h : 720
  const rong = meta.w > 0 ? meta.w : 1280
  const ts = rong < co ? DOC : NGANG
  const marginV = Math.round(co * 0.04)

  let fontSize = Math.round(co * ts.tuDong)
  let y = 0
  let bh = 0
  let x = 0
  let bw = rong
  let tamY: number | null = null

  if (subRegion && subRegion.y1 > subRegion.y0 && subRegion.x1 > subRegion.x0) {
    y = Math.max(0, subRegion.y0)
    bh = Math.min(co - y, subRegion.y1 - subRegion.y0)
    x = Math.max(0, subRegion.x0)
    bw = Math.min(rong - x, subRegion.x1 - subRegion.x0)

    // Co chu tinh TRUC TIEP theo chieu cao khung phu de user keo
    fontSize = Math.max(14, Math.round(bh * 0.7))
    tamY = Math.round(y + bh / 2)
  }

  y -= y % 2
  bh -= bh % 2
  if (bh < 2) bh = 2
  if (y + bh > co) bh = Math.max(2, co - y - ((co - y) % 2))

  x -= x % 2
  bw -= bw % 2
  if (bw < 2) bw = 2
  if (x + bw > rong) bw = Math.max(2, rong - x - ((rong - x) % 2))

  const vien = Math.max(1, Math.round(fontSize * 0.12))
  return {
    che: !!lamMo,
    y,
    bh,
    x,
    bw,
    sigma: Math.max(8, Math.round(co * 0.03)),
    fontSize,
    vien,
    marginV,
    tamY
  }
}

/** Mot cau phu de da tach khoi .srt. */
interface Cue {
  a: string // moc bat dau
  b: string // moc ket thuc
  chu: string // noi dung (nhieu dong noi bang \N)
}

/**
 * Tach .srt thanh danh sach cau. Tach RIENG (khong nam trong taoAss) vi phan
 * tinh bo cuc cung can dem so ky tu de biet chu se xuong may dong.
 */
export function docSrt(srtRaw: string): Cue[] {
  const out: Cue[] = []
  const cleanText = srtRaw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = cleanText.split('\n')

  let currentCue: { a: string; b: string; textLines: string[] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.includes('-->')) {
      if (currentCue && currentCue.textLines.length > 0) {
        // Loai bo dong so thu tu SRT bi dinh nham vao cuoi cue truoc
        while (
          currentCue.textLines.length > 1 &&
          /^\d+$/.test(currentCue.textLines[currentCue.textLines.length - 1])
        ) {
          currentCue.textLines.pop()
        }
        out.push({
          a: currentCue.a,
          b: currentCue.b,
          chu: currentCue.textLines.join('\\N').replace(/[{}]/g, '')
        })
      }
      const parts = line.split('-->')
      currentCue = {
        a: parts[0].trim(),
        b: parts[1].trim(),
        textLines: []
      }
    } else if (currentCue) {
      if (/^\d+$/.test(line) && currentCue.textLines.length === 0) {
        continue
      }
      if (line.length > 0) {
        currentCue.textLines.push(line)
      }
    }
  }

  if (currentCue && currentCue.textLines.length > 0) {
    out.push({
      a: currentCue.a,
      b: currentCue.b,
      chu: currentCue.textLines.join('\\N').replace(/[{}]/g, '')
    })
  }

  return out
}

/** Moc thoi gian .srt "HH:MM:SS,mmm" -> so giay. Hong thi tra 0. */
function giay(t: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t.trim())
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

/**
 * Thoi diem KET THUC cua cau cuoi trong file .srt (giay). Dung de canh bao user
 * khi ho chon nham file phu de lech han so voi video.
 */
export async function srtGiay(duong: string): Promise<number> {
  try {
    const cues = docSrt(await readFile(duong, 'utf8'))
    let max = 0
    for (const c of cues) max = Math.max(max, giay(c.b))
    return max
  } catch {
    return 0
  }
}

/** So giay -> moc .srt "HH:MM:SS,mmm". */
function mocSrt(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, d = 2): string => String(n).padStart(d, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(
    Math.floor((ms % 60000) / 1000)
  )},${p(ms % 1000, 3)}`
}

/**
 * Cat .srt cho vua thoi luong video: bo han cau bat dau sau khi video da het,
 * va keo mep cuoi cua cau VAT NGANG ve dung luc video ket thuc.
 *
 * !! TU CAT chu KHONG dung co san cua ffmpeg — da do that ca hai deu sai:
 *    - `-shortest`: LAM MAT HAN cau vat ngang (cau 2s->10s tren video 3s cho ra
 *      luong phu de rong tuot, mat ca doan dang le phai hien tu giay 2 den 3).
 *    - `-t` / `-to`: khong dung gi toi luong phu de (van de nguyen 10s).
 */
export function catSrtTheoVideo(cues: Cue[], giayVideo: number): string {
  const ra: string[] = []
  for (const c of cues) {
    const batDau = giay(c.a)
    if (batDau >= giayVideo) continue // cau khong bao gio hien -> bo
    const ketThuc = Math.min(giay(c.b), giayVideo) // cau vat ngang -> keo ve cuoi video
    if (ketThuc <= batDau) continue
    ra.push(
      `${ra.length + 1}\n${mocSrt(batDau)} --> ${mocSrt(ketThuc)}\n` +
        `${c.chu.split('\\N').join('\n')}\n`
    )
  }
  return ra.join('\n')
}

/** Doi mot moc thoi gian .srt "HH:MM:SS,mmm" -> .ass "H:MM:SS.cc". */
function gioAss(t: string): string {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t.trim())
  if (!m) return '0:00:00.00'
  const cs = Math.round(Number((m[4] + '00').slice(0, 3)) / 10)
  return `${Number(m[1])}:${m[2]}:${m[3]}.${String(cs).padStart(2, '0')}`
}

/**
 * .srt -> .ass, ĐẶT PlayResX/Y = KICH THUOC VIDEO. Vi sao KHONG dung filter
 * `subtitles=...:force_style`: no doc .srt voi PlayResY mac dinh (~288) nen
 * FontSize/MarginV (tinh theo pixel video) bi phong ~2.5x va DAT SAI CHO -> chu
 * khong nam trong dai mo. Da do that. Voi PlayRes = video thi moi so la pixel that.
 */
import { readFileSync } from 'node:fs'

/**
 * Doc file srt tu dong nhan dien encoding (UTF-8, UTF-16LE/BE, EUC-KR cho chu Han)
 */
export function docFileSrt(duong: string): string {
  const buf = readFileSync(duong)
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf16le')
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    try {
      return new TextDecoder('utf-16be').decode(buf)
    } catch {
      return buf.toString('utf16le')
    }
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf8').slice(1)
  }

  const utf8Str = buf.toString('utf8')
  if (utf8Str.includes('\uFFFD')) {
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return buf.toString('latin1')
    }
  }
  return utf8Str
}


export function ngatDongTheoDoRong(text: string, maxUnits: number, isCJK: boolean): string {
  if (!text) return ''

  if (isCJK) {
    const chars = Array.from(text)
    const lines: string[] = []
    let currentLine = ''
    let currentUnits = 0

    for (const char of chars) {
      const charUnit = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fa5\uac00-\ud7a3]/.test(char) ? 1.0 : 0.5
      if (currentUnits + charUnit > maxUnits) {
        if (currentLine) lines.push(currentLine)
        currentLine = char
        currentUnits = charUnit
      } else {
        currentLine += char
        currentUnits += charUnit
      }
    }
    if (currentLine) lines.push(currentLine)
    return lines.join('\\N')
  } else {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''
    let currentUnits = 0

    for (const word of words) {
      let wordUnits = 0
      for (const char of word) {
        wordUnits += /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fa5\uac00-\ud7a3]/.test(char) ? 1.0 : 0.5
      }
      const spaceUnit = currentLine ? 0.5 : 0
      if (currentUnits + spaceUnit + wordUnits > maxUnits) {
        if (currentLine) lines.push(currentLine)
        currentLine = word
        currentUnits = wordUnits
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word
        currentUnits += spaceUnit + wordUnits
      }
    }
    if (currentLine) lines.push(currentLine)
    return lines.join('\\N')
  }
}

export function taoAss(cues: Cue[], meta: Meta, bc: BoCuc): string {
  const w = meta.w > 0 ? meta.w : 1280
  const h = meta.h > 0 ? meta.h : 720

  const marginL = bc.x > 0 ? bc.x : Math.round(w * 0.08)
  const marginR = bc.x > 0 && bc.bw > 0 ? Math.max(0, w - (bc.x + bc.bw)) : Math.round(w * 0.08)
  const boxWidth = w - marginL - marginR

  // MarginV tinh tu day video len day duoi khung phu de
  // \an2 = bottom-center: libass dat dong cuoi cung cach day video marginV pixel
  // => chu se nam SAT day khung sub va duoc phep tran len tren neu nhieu dong
  const marginV = bc.tamY != null ? Math.max(0, h - (bc.y + bc.bh)) : bc.marginV

  // Tu dong phat hien va cau hinh font phu hop cho nhieu ngon ngu (Trung, Nhat, Han, Thai, An, A Rap...)
  const textSample = cues.map((c) => c.chu).join('')
  let fontName = 'Arial'
  const isJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(textSample)
  const isChinese = /[\u4e00-\u9fa5]/.test(textSample)
  const isCJK = isJapanese || isChinese

  if (isJapanese) {
    // Tieng Nhat (uu tien nhan dien truoc do tieng Nhat co chua chu Kanji trung voi tieng Trung)
    fontName = 'MS Gothic'
  } else if (/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(textSample)) {
    // Tieng Han
    fontName = 'Malgun Gothic'
  } else if (isChinese) {
    // Tieng Trung (Gian/Phon the)
    fontName = 'Microsoft YaHei'
  } else if (/[\u0e00-\u0e7f]/.test(textSample)) {
    // Tieng Thai
    fontName = 'Leelawadee UI'
  } else if (/[\u0900-\u097f]/.test(textSample)) {
    // Tieng An (Devanagari/Hindi...)
    fontName = 'Nirmala UI'
  } else if (/[\u0600-\u06ff]/.test(textSample)) {
    // Tieng A Rap
    fontName = 'Segoe UI'
  }

  // Tinh gioi han don vi do rong tuong doi tren moi dong (safe margin = 0.5 don vi)
  const maxUnits = Math.max(8, (boxWidth / bc.fontSize) - 0.5)

  // Alignment=2 (\an2 = bottom-center)
  const style =
    `Style: D,${fontName},${bc.fontSize},&H00FFFFFF&,&H00000000&,&H00000000&,&H00000000&,` +
    `0,0,0,0,100,100,0,0,1,${bc.vien},0,2,${marginL},${marginR},${marginV},1`

  const events = cues.map((c) => {
    const textFormatted = ngatDongTheoDoRong(c.chu, maxUnits, isCJK)
    return `Dialogue: 0,${gioAss(c.a)},${gioAss(c.b)},D,,0,0,0,,${textFormatted}`
  })

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n')
}

/**
 * Cac tham so filter cho ffmpeg. Supports N blur regions using split=N+1 stream architecture.
 */
function taoFilterComplex(
  meta: Meta,
  regions: BlurRegion[],
  lamMo: boolean,
  coAss: boolean,
  assName: string,
  batAmThanh = false,
  hasAudioFile = false,
  audioVolume = 100
): string[] {
  const sigma = Math.max(8, Math.round((meta.h > 0 ? meta.h : 720) * 0.03))
  const validRegions = lamMo ? regions.filter((r) => r.x1 > r.x0 && r.y1 > r.y0) : []

  const hasVideoFilters = validRegions.length > 0 || coAss
  const lines: string[] = []

  if (hasVideoFilters) {
    const N = validRegions.length
    const w = meta.w > 0 ? meta.w : 1280
    const h = meta.h > 0 ? meta.h : 720

    if (N > 0) {
      // 1. Split luong goc [0:v] thành (N + 1) luong doc lap
      const splitLabels = Array.from({ length: N }, (_, i) => `[c${i}]`).join('')
      lines.push(`[0:v]split=${N + 1}[main]${splitLabels}`)

      // 2. Crop va gblur doc lap cho tung vung tu luong [c${i}]
      for (let i = 0; i < N; i++) {
        const r = validRegions[i]
        let x = Math.max(0, r.x0)
        let bw = Math.min(w - x, r.x1 - r.x0)
        let y = Math.max(0, r.y0)
        let bh = Math.min(h - y, r.y1 - r.y0)

        x -= x % 2
        bw -= bw % 2
        if (bw < 2) bw = 2
        if (x + bw > w) bw = Math.max(2, w - x - ((w - x) % 2))

        y -= y % 2
        bh -= bh % 2
        if (bh < 2) bh = 2
        if (y + bh > h) bh = Math.max(2, h - y - ((h - y) % 2))

        lines.push(`[c${i}]crop=${bw}:${bh}:${x}:${y},gblur=sigma=${sigma}:steps=3[b${i}]`)
      }

      // 3. Overlay noi tiep lan luot cac vung mo len luong [main]
      let prev = 'main'
      for (let i = 0; i < N; i++) {
        const r = validRegions[i]
        let x = Math.max(0, r.x0)
        let y = Math.max(0, r.y0)
        x -= x % 2
        y -= y % 2

        const outLbl = i === N - 1 && !coAss ? '[out]' : `[v${i + 1}]`
        lines.push(`[${prev}][b${i}]overlay=${x}:${y}${outLbl}`)
        prev = `v${i + 1}`
      }

      // 4. Ghep phu de neu co
      if (coAss) {
        lines.push(`[${prev}]ass=${assName}[out]`)
      }
    } else {
      // Chi co ass, khong co blur
      lines.push(`[0:v]ass=${assName}[out]`)
    }
  }

  // Phối trộn âm thanh
  if (batAmThanh) {
    if (meta.hasAudio) {
      const volRatio = Math.pow(audioVolume / 100, 2)
      let audioFilter = ''
      if (hasAudioFile) {
        // Có nhạc nền + có âm thanh gốc -> Trộn
        audioFilter = `[0:a]volume=${volRatio}[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first[a_mix]`
      } else {
        // Không nhạc nền + có âm thanh gốc -> Chỉ chỉnh âm lượng gốc
        audioFilter = `[0:a]volume=${volRatio}[a_mix]`
      }
      
      if (hasVideoFilters) {
        lines.push(audioFilter)
        return ['-filter_complex', lines.join(';'), '-map', '[out]', '-map', '[a_mix]']
      } else {
        return ['-filter_complex', audioFilter, '-map', '0:v', '-map', '[a_mix]']
      }
    } else {
      // Video gốc câm (không âm thanh)
      if (hasAudioFile) {
        // Có nhạc nền -> Map trực tiếp nhạc nền vào đầu ra
        if (hasVideoFilters) {
          return ['-filter_complex', lines.join(';'), '-map', '[out]', '-map', '1:a']
        } else {
          return ['-map', '0:v', '-map', '1:a']
        }
      } else {
        // Không nhạc nền -> Không cần âm thanh
        if (hasVideoFilters) {
          return ['-filter_complex', lines.join(';'), '-map', '[out]']
        } else {
          return []
        }
      }
    }
  } else {
    // Không bật cấu hình âm thanh
    if (hasVideoFilters) {
      return ['-filter_complex', lines.join(';'), '-map', '[out]', '-map', '0:a?']
    } else {
      return []
    }
  }
}

/** Chay 1 lan ffmpeg, bao tien do theo `time=` tren stderr. */
async function chay(
  ff: string,
  args: string[],
  cwd: string,
  meta: Meta,
  onProgress: (p: BurnProgress) => void
): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(ff, args, { cwd, windowsHide: true })
    child = p
    let errTail = ''
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      const lines = s.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        
        // Neu chua thong tin thoi gian thi cap nhat tien do
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(trimmed)
        if (m && meta.giay > 0) {
          const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          onProgress({ percent: Math.min(99, Math.round((sec / meta.giay) * 100)) })
        }
        
        // Log chan doan loi font/ass tu FFmpeg
        const lower = trimmed.toLowerCase()
        if (
          lower.includes('ass') ||
          lower.includes('font') ||
          lower.includes('error') ||
          lower.includes('warning') ||
          lower.includes('failed')
        ) {
          logInfo(`[ffmpeg] ${trimmed}`)
        }
      }
      const last = s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })
    p.on('error', (err) => {
      debugRaw('burn spawn', err)
      child = null
      resolve(-1)
    })
    p.on('close', (code) => {
      child = null
      if (code !== 0 && errTail) debugRaw('burn close', errTail)
      resolve(code)
    })
  })
}

async function duLon(f: string): Promise<boolean> {
  try {
    return (await stat(f)).size > 4096 // nvenc hong -> file 0 byte / vai byte
  } catch {
    return false
  }
}

/**
 * Ghep phu de / Lam mo video.
 */
export async function burnSubtitle(
  req: BurnReq,
  onProgress: (p: BurnProgress) => void
): Promise<BurnResult> {
  daHuy = false
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const hasSrt = Boolean(req.srt && req.srt.trim())
  const regions = req.blurRegions || []
  const hasBlur = Boolean(req.lamMo && regions.length > 0)
  const hasAudioFile = Boolean(req.batAmThanh && req.amThanhFile)

  if (!hasSrt && !hasBlur && !req.batAmThanh) {
    return { ok: false, error: 'Vui lòng chọn ít nhất 1 vùng làm mờ, tải lên tệp phụ đề hoặc bật cấu hình âm thanh.' }
  }

  const goc = basename(req.video).replace(/\.[^.]+$/, '')
  const output = join(req.outputDir, `${goc}${req.mode === 'burn' ? '-phude' : '-phude-mem'}.mp4`)

  const tam = join(tmpdir(), 'tblao-burn')
  await mkdir(tam, { recursive: true })
  const srtTam = join(tam, 'sub.srt')

  if (hasSrt && req.srt) {
    await copyFile(req.srt, srtTam)
  }

  if (hasSrt && req.mode === 'soft') {
    logInfo(`Dịch màn hình: gắn phụ đề rời vào ${basename(req.video)}…`)
    
    const args = ['-y', '-i', req.video, '-i', 'sub.srt']
    if (hasAudioFile) {
      args.push('-i', req.amThanhFile!)
    }

    const meta = await doVideo(duongFfprobe(ff), req.video)
    if (req.catSrt && meta.giay > 0) {
      const cues = docSrt(docFileSrt(srtTam))
      await writeFile(srtTam, catSrtTheoVideo(cues, meta.giay), 'utf8')
      logInfo('Dịch màn hình: đã cắt phụ đề cho vừa độ dài video.')
    }

    if (req.batAmThanh) {
      if (meta.hasAudio) {
        const vol = Math.pow((req.amLuongGoc ?? 100) / 100, 2)
        if (hasAudioFile) {
          args.push(
            '-filter_complex', `[0:a]volume=${vol}[a0];[2:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first[a_mix]`,
            '-map', '0:v', '-map', '1:s', '-map', '[a_mix]',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
            '-c:a', 'aac'
          )
        } else {
          // Chỉ chỉnh âm lượng gốc
          args.push(
            '-filter_complex', `[0:a]volume=${vol}[a_mix]`,
            '-map', '0:v', '-map', '1:s', '-map', '[a_mix]',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
            '-c:a', 'aac'
          )
        }
      } else {
        // Video gốc câm
        if (hasAudioFile) {
          args.push(
            '-map', '0:v', '-map', '1:s', '-map', '2:a',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
            '-c:a', 'aac'
          )
        } else {
          args.push(
            '-map', '0:v', '-map', '1:s',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie'
          )
        }
      }
    } else {
      args.push(
        '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie'
      )
    }

    args.push(output)

    const code = await chay(ff, args, tam, meta, onProgress)
    if (hasSrt) await rm(srtTam, { force: true })
    if (daHuy) return { ok: false, error: 'Đã huỷ.' }
    if (code === 0 && (await duLon(output))) {
      logInfo('Dịch màn hình: gắn phụ đề rời xong.')
      return { ok: true, output }
    }
    return { ok: false, error: 'Ghép phụ đề thất bại.' }
  }

  // ---- Dot chet (Render lai video) ----
  const meta = await doVideo(duongFfprobe(ff), req.video)
  let bc: BoCuc | null = null
  const duongAss = join(tam, 'sub.ass')

  if (hasSrt) {
    const srtRaw = docFileSrt(srtTam)
    const cues = docSrt(srtRaw)
    logInfo(`Dịch màn hình: đọc được ${cues.length} câu phụ đề.`)
    bc = boCuc(meta, req.subRegion, req.lamMo)
    await writeFile(duongAss, taoAss(cues, meta, bc), 'utf8')
  }

  // FFmpeg chay voi cwd = tam nen chi can ten tuong doi 'sub.ass'
  const filterArgs = taoFilterComplex(
    meta,
    regions,
    req.lamMo ?? false,
    hasSrt,
    'sub.ass',
    req.batAmThanh ?? false,
    hasAudioFile,
    req.amLuongGoc ?? 100
  )
  logInfo(`Dịch màn hình: đang xử lý video ${basename(req.video)}…`)
  if (filterArgs.length > 0) {
    debugRaw('burn filter_complex', filterArgs.join(' '))
  }

  const encoders: Array<{ ten: string; gpu: boolean; args: string[] }> = [
    { ten: 'h264_nvenc', gpu: true, args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] },
    { ten: 'h264_amf', gpu: true, args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
    { ten: 'h264_qsv', gpu: true, args: ['-c:v', 'h264_qsv', '-global_quality', '23'] },
    { ten: 'libx264', gpu: false, args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'] }
  ]

  for (const enc of encoders) {
    if (daHuy) break

    const inputArgs = hasAudioFile
      ? ['-y', '-i', req.video, '-i', req.amThanhFile!]
      : ['-y', '-i', req.video]

    const dungFilterAudio = req.batAmThanh && (meta.hasAudio || hasAudioFile)
    const audioCodecArgs = dungFilterAudio ? ['-c:a', 'aac'] : ['-c:a', 'copy']

    const args = filterArgs.length > 0
      ? [...inputArgs, ...filterArgs, ...enc.args, ...audioCodecArgs, output]
      : [...inputArgs, ...enc.args, ...audioCodecArgs, output]

    const code = await chay(ff, args, tam, meta, onProgress)
    if (daHuy) {
      if (hasSrt) await rm(srtTam, { force: true })
      return { ok: false, error: 'Đã huỷ.' }
    }
    if (code === 0 && (await duLon(output))) {
      if (hasSrt) await rm(srtTam, { force: true })
      logInfo(`Dịch màn hình: xử lý video xong${enc.gpu ? ' (tăng tốc GPU)' : ''}.`)
      return { ok: true, output }
    }
  }

  if (hasSrt) await rm(srtTam, { force: true })
  return { ok: false, error: 'Xử lý video thất bại.' }
}
