import { spawn, type ChildProcess } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { mkdir, copyFile, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logInfo } from './logger'
import type { BurnReq, BurnProgress, BurnResult, CoChu } from '../shared/types'

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
  marginH: number // le trai/phai (pixel video)
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
 * Uoc so dong sau khi TU XUONG DONG, de biet dai mo phai cao bao nhieu.
 * Arial: mot ky tu rong trung binh ~0.5 co chu (do that: 42 ky tu vua 994px o
 * co chu 50 -> 0.47). Lay 0.5 cho hoi du -> uoc THUA dong, dai mo rong hon mot
 * chut: sai theo huong an toan (chu luon co nen mo phia sau).
 */
function demDong(cues: Cue[], fontSize: number, rongDung: number): number {
  const moiDong = Math.max(8, Math.floor(rongDung / (fontSize * 0.5)))
  let max = 1
  for (const c of cues) {
    let n = 0
    for (const doan of c.chu.split('\\N')) n += Math.max(1, Math.ceil(doan.length / moiDong))
    if (n > max) max = n
  }
  return Math.min(max, 4) // chan 4 dong keo mo ca man hinh
}

/**
 * Tinh bo cuc dot chu tu kich thuoc video + dai chu goc.
 * Che phu de goc kieu BLUR (kinh mo, giong CapCut) — do that dep hon thanh den
 * cung. Huong video (ngang/doc) lay tu ffprobe -> chon bo tham so tuong ung.
 */
export function boCuc(
  meta: Meta,
  cues: Cue[],
  bandTop?: number | null,
  bandBot?: number | null,
  coChu?: CoChu
): BoCuc {
  const co = meta.h > 0 ? meta.h : 720
  const rong = meta.w > 0 ? meta.w : 1280
  // Vuong (1:1) tinh la DOC -> moc theo be rong, dung y do.
  const ts = rong < co ? DOC : NGANG
  const moc = ts.theoCao ? co : rong
  const marginH = Math.round(rong * ts.le)
  const fMin = Math.round(moc * ts.min)
  const fMax = Math.max(fMin, Math.round(moc * ts.max))
  const chan = (px: number): number => Math.max(fMin, Math.min(fMax, Math.round(px)))
  // KHONG con chan theo be rong nua: tu xuong dong (WrapStyle 0) da lo chuyen
  // tran ngang, nen chan them chi lam thang co chu bi bop lai.
  const tay = coChu && coChu !== 'auto' ? ts.thang[coChu] : null

  let fontSize = tay ? chan(moc * tay) : chan(moc * ts.tuDong)
  let che = false
  let y = 0
  let bh = 0
  let marginV = Math.round(co * 0.04)

  if (bandTop != null && bandBot != null && bandBot > bandTop) {
    che = true
    y = Math.max(0, bandTop)
    bh = Math.min(co - y, bandBot - bandTop)
    // Tu dong khi CO khung: theo chieu cao khung user keo (1 dong vua khung).
    fontSize = tay ? chan(moc * tay) : chan(bh * 0.5)
  }

  const cao1Dong = Math.round(fontSize * 1.5)

  if (che) {
    // Dong CUOI can giua khung user keo (Alignment=2 do le tu day khung hinh).
    marginV = Math.max(2, Math.round(co - (y + bh / 2) - cao1Dong / 2))
    // !! NOI DAI MO CHO DU SO DONG THAT.
    // Chu neo mep DUOI roi moc NGUOC LEN, nen khi xuong 2-3 dong thi cac dong
    // tren troi ra ngoai dai mo, nam tren video con net (va co the de len phan
    // phu de goc chua duoc che). Dai mo phai trum ca khung user LAN khoi chu.
    const soDong = demDong(cues, fontSize, rong - 2 * marginH)
    const day = co - marginV // day khoi chu
    const tren = day - soDong * cao1Dong // dinh khoi chu
    const dem = Math.round(cao1Dong * 0.15)
    let t = Math.max(0, Math.min(y, tren - dem))
    const d = Math.min(co, Math.max(y + bh, day + dem))
    const toiDa = Math.round(co * 0.3) // khong mo qua 30% khung hinh
    if (d - t > toiDa) t = d - toiDa
    y = t
    bh = Math.max(2, d - t)
  }
  // crop/overlay tren yuv420p: toa do va kich thuoc le se lam ffmpeg vo.
  y -= y % 2
  bh -= bh % 2
  if (bh < 2) bh = 2
  if (y + bh > co) bh = Math.max(2, co - y - ((co - y) % 2))
  const vien = Math.max(1, Math.round(fontSize * 0.12)) // vien ti le co chu
  return { che, y, bh, sigma: Math.max(8, Math.round(co * 0.03)), fontSize, vien, marginV, marginH }
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
  // Moi khoi = so thu tu / moc "a --> b" / cac dong chu.
  for (const k of srtRaw.replace(/^﻿/, '').split(/\r?\n\r?\n+/)) {
    const dong = k
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const iMoc = dong.findIndex((d) => d.includes('-->'))
    if (iMoc < 0) continue
    const [a, b] = dong[iMoc].split('-->')
    const chu = dong
      .slice(iMoc + 1)
      .join('\\N')
      .replace(/[{}]/g, '') // { } la ky tu dieu khien cua .ass -> bo di
    if (!chu) continue
    out.push({ a, b, chu })
  }
  return out
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
export function taoAss(cues: Cue[], meta: Meta, bc: BoCuc): string {
  const w = meta.w > 0 ? meta.w : 1280
  const h = meta.h > 0 ? meta.h : 720
  const style =
    `Style: D,Arial,${bc.fontSize},&H00FFFFFF,&H00000000,&H00000000,` +
    `0,0,0,0,100,100,0,0,1,${bc.vien},0,2,${bc.marginH},${bc.marginH},${bc.marginV},1`

  const events = cues.map(
    (c) => `Dialogue: 0,${gioAss(c.a)},${gioAss(c.b)},D,,0,0,0,,${c.chu}`
  )

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    // 0 = tu xuong dong thong minh (cac dong deu nhau). PHAI la 0: truoc dung 2
    // (= TAT tu xuong dong) nen cau dai chay thang ra ngoai khung, video doc 9:16
    // tran nang nhat. \N trong text van xuong dong nhu cu.
    'WrapStyle: 0',
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
  // Doc .srt TRUOC: bo cuc can dem so ky tu de biet chu xuong may dong -> noi
  // dai mo cho du. Roi doi sang .ass (PlayRes = video) de dat dung pixel.
  const srtRaw = await readFile(srtTam, 'utf8')
  const cues = docSrt(srtRaw)
  const bc = boCuc(meta, cues, req.bandTop, req.bandBot, req.coChu)
  await writeFile(join(tam, 'sub.ass'), taoAss(cues, meta, bc), 'utf8')
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
