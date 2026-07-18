import { spawn, type ChildProcess } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { mkdir, copyFile, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logInfo } from './logger'
import type { BurnReq, BurnProgress, BurnResult } from '../shared/types'

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
}

/** Lay kich thuoc + thoi luong video (de tinh co chu, le, phan tram tien do). */
async function doVideo(ffprobe: string, video: string): Promise<Meta> {
  return new Promise((resolve) => {
    const p = spawn(
      ffprobe,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
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
        giay: Number(/duration=([\d.]+)/.exec(out)?.[1]) || 0
      })
    })
    p.on('error', () => resolve({ w: 0, h: 0, giay: 0 }))
  })
}

interface BoCuc {
  che: boolean // co che phu de goc khong
  y: number // mep tren dai che (pixel)
  bh: number // chieu cao dai che
  sigma: number // do manh blur (gaussian)
  fontSize: number // co chu (PIXEL VIDEO — nho .ass co PlayResY = chieu cao video)
  vien: number // do day vien
  marginV: number // le duoi (pixel video)
}

/**
 * Tinh bo cuc dot chu tu kich thuoc video + dai chu goc.
 * Che phu de goc kieu BLUR (kinh mo, giong CapCut) — do that dep hon thanh den
 * cung, va chu Trung tan han vao dai mo (khong con doc duoc). Font/co/le scale
 * theo chieu cao video.
 */
function boCuc(
  meta: Meta,
  bandTop?: number | null,
  bandBot?: number | null,
  fontScale?: number | null
): BoCuc {
  const co = meta.h > 0 ? meta.h : 720
  // Chan co chu: min 2% (con doc duoc khi xem), max 5.5% (khong to lo) chieu cao.
  const fMin = Math.round(co * 0.02)
  const fMax = Math.round(co * 0.055)
  const chan = (px: number): number => Math.max(fMin, Math.min(fMax, Math.round(px)))
  // Co chu user ep tay (fontScale) hay tu dong. Tu dong khi KHONG che = 4.2%.
  const tay = fontScale != null && fontScale > 0
  let fontSize = tay ? chan(co * fontScale) : Math.round(co * 0.042)
  let che = false
  let y = 0
  let bh = 0
  let marginV = Math.round(co * 0.04)
  if (bandTop != null && bandBot != null && bandBot > bandTop) {
    che = true
    y = Math.max(0, bandTop)
    bh = Math.min(co - y, bandBot - bandTop) // dai mo = DUNG khung user (WYSIWYG)
    // Co chu: user ep tay -> theo fontScale; else TU DONG theo chieu cao khung.
    // Khung min (RegionBox) da = 1 dong chu nen chu tu dong luon vua.
    fontSize = tay ? chan(co * fontScale) : chan(bh * 0.5)
    const cao1Dong = Math.round(fontSize * 1.5)
    // Canh GIUA doc: day chu = giua_khung + nua_dong (Alignment=2 do le tu day khung)
    marginV = Math.max(2, Math.round(co - (y + bh / 2) - cao1Dong / 2))
  }
  const vien = Math.max(1, Math.round(fontSize * 0.12)) // vien ti le co chu
  return { che, y, bh, sigma: Math.max(8, Math.round(co * 0.03)), fontSize, vien, marginV }
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
function taoAss(srtRaw: string, meta: Meta, bc: BoCuc): string {
  const w = meta.w > 0 ? meta.w : 1280
  const h = meta.h > 0 ? meta.h : 720
  const style =
    `Style: D,Arial,${bc.fontSize},&H00FFFFFF,&H00000000,&H00000000,` +
    `0,0,0,0,100,100,0,0,1,${bc.vien},0,2,${Math.round(w * 0.02)},${Math.round(w * 0.02)},${bc.marginV},1`

  const events: string[] = []
  // Tach khoi .srt: moi khoi = so thu tu / moc "a --> b" / cac dong chu.
  const khoi = srtRaw.replace(/^﻿/, '').split(/\r?\n\r?\n+/)
  for (const k of khoi) {
    const dong = k.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const iMoc = dong.findIndex((d) => d.includes('-->'))
    if (iMoc < 0) continue
    const [a, b] = dong[iMoc].split('-->')
    const chu = dong
      .slice(iMoc + 1)
      .join('\\N')
      .replace(/[{}]/g, '') // { } la ky tu dieu khien cua .ass -> bo di
    if (!chu) continue
    events.push(`Dialogue: 0,${gioAss(a)},${gioAss(b)},D,,0,0,0,,${chu}`)
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n')
}

/**
 * Cac tham so filter cho ffmpeg. `srtName` la ten TRAN (ffmpeg chay voi cwd =
 * thu muc chua srt) -> tranh HOAN TOAN bay escaping dau ':' cua o dia.
 *  - Co che: filter_complex = crop dai goc -> boxblur -> overlay lai -> subtitles.
 *  - Khong che: chi -vf subtitles.
 */
function argsFilter(assName: string, bc: BoCuc): string[] {
  const sub = `ass=${assName}` // dung .ass (PlayRes = video) -> pixel that, dat dung cho
  if (!bc.che) return ['-vf', sub]
  // gblur (gaussian) chu KHONG boxblur: boxblur chan ban kinh chroma theo chieu
  // cao dai (dai mong <25) -> user khoanh khung mong la vo ('Invalid chroma_param
  // radius'). gblur khong dinh gioi han do, va nhin muot hon.
  const fc =
    `[0:v]crop=iw:${bc.bh}:0:${bc.y},gblur=sigma=${bc.sigma}:steps=3[b];` +
    `[0:v][b]overlay=0:${bc.y}[v];[v]${sub}[out]`
  return ['-filter_complex', fc, '-map', '[out]', '-map', '0:a?']
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
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
      if (m && meta.giay > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        onProgress({ percent: Math.min(99, Math.round((sec / meta.giay) * 100)) })
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
 * Ghep phu de vao video.
 *  - 'soft': ghep mem (ranh sub), nhanh, giu nguyen chat — xem tren may.
 *  - 'burn': dot chet vao pixel (dang lai) + che phu de goc bang BLUR (kinh mo).
 * Encoder: thu h264_nvenc (GPU) -> tut libx264 (nvenc de chet vi driver, ra 0 byte).
 */
export async function burnSubtitle(
  req: BurnReq,
  onProgress: (p: BurnProgress) => void
): Promise<BurnResult> {
  daHuy = false
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const goc = basename(req.video).replace(/\.[^.]+$/, '')
  const output = join(req.outputDir, `${goc}${req.mode === 'burn' ? '-phude' : '-phude-mem'}.mp4`)

  // Copy srt sang thu muc tam ten TRAN "sub.srt" -> chay ffmpeg voi cwd o day.
  // Tranh HOAN TOAN bay escaping dau ':' cua o dia va ky tu la trong ten tep.
  const tam = join(tmpdir(), 'tblao-burn')
  await mkdir(tam, { recursive: true })
  const srtTam = join(tam, 'sub.srt')
  await copyFile(req.srt, srtTam)

  if (req.mode === 'soft') {
    logInfo(`Dịch màn hình: gắn phụ đề rời vào ${basename(req.video)}…`)
    const args = [
      '-y', '-i', req.video, '-i', 'sub.srt',
      '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
      output
    ]
    const meta = await doVideo(duongFfprobe(ff), req.video)
    const code = await chay(ff, args, tam, meta, onProgress)
    await rm(srtTam, { force: true })
    if (daHuy) return { ok: false, error: 'Đã huỷ.' }
    if (code === 0 && (await duLon(output))) {
      logInfo('Dịch màn hình: gắn phụ đề rời xong.')
      return { ok: true, output }
    }
    return { ok: false, error: 'Ghép phụ đề thất bại.' }
  }

  // ---- Dot chet ----
  const meta = await doVideo(duongFfprobe(ff), req.video)
  const bc = boCuc(meta, req.bandTop, req.bandBot, req.fontScale)
  // Doi .srt -> .ass (PlayRes = video) de dat phu de DUNG PIXEL, khop dai mo.
  const srtRaw = await readFile(srtTam, 'utf8')
  await writeFile(join(tam, 'sub.ass'), taoAss(srtRaw, meta, bc), 'utf8')
  const filterArgs = argsFilter('sub.ass', bc)
  logInfo(`Dịch màn hình: ghép phụ đề vào ${basename(req.video)}…`)

  // Thu GPU truoc (nhanh hon nhieu voi video dai/HD) -> tut CPU neu deu hong.
  // Thu tu: NVIDIA -> AMD -> Intel -> CPU. Encoder GPU hong thi that bai ngay
  // luc khoi tao (nhanh), khong ton thoi gian ma hoa ca video.
  // ⚠️ amf/qsv chua test that (may dev khong co GPU AMD/Intel) — viet theo chuan,
  //    dua vao co che tut CPU. Se hieu chinh theo bao cao user sau khi phat hanh.
  const encoders: Array<{ ten: string; gpu: boolean; args: string[] }> = [
    { ten: 'h264_nvenc', gpu: true, args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] },
    { ten: 'h264_amf', gpu: true, args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
    { ten: 'h264_qsv', gpu: true, args: ['-c:v', 'h264_qsv', '-global_quality', '23'] },
    { ten: 'libx264', gpu: false, args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'] }
  ]
  for (const enc of encoders) {
    if (daHuy) break
    const args = ['-y', '-i', req.video, ...filterArgs, ...enc.args, '-c:a', 'copy', output]
    const code = await chay(ff, args, tam, meta, onProgress)
    if (daHuy) {
      await rm(srtTam, { force: true })
      return { ok: false, error: 'Đã huỷ.' }
    }
    if (code === 0 && (await duLon(output))) {
      await rm(srtTam, { force: true })
      // Bao chung chung GPU/CPU (khong lo ten encoder) — giup user doi chieu bao cao.
      logInfo(`Dịch màn hình: ghép phụ đề xong${enc.gpu ? ' (tăng tốc GPU)' : ''}.`)
      return { ok: true, output }
    }
    // enc hong (vd nvenc chet vi driver -> 0 byte) -> thu encoder sau
  }
  await rm(srtTam, { force: true })
  return { ok: false, error: 'Ghép phụ đề thất bại.' }
}
