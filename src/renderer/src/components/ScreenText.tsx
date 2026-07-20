import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { CoChu } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import { hasFeature } from '../lib/license'
import RegionBox, { type Region } from './RegionBox'
import GeminiKey from './GeminiKey'

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

/**
 * Duong dan tren dia -> URL trinh phat doc duoc (giao thuc `tblao:` dang ky ben main).
 * KHONG dung file:// — trang chay o http://localhost (dev) nen file:// la khac
 * nguon, bi CSP + webSecurity chan, video ra o den.
 *
 * !! Duong dan di qua BASE64, va host "b64" KHONG duoc bo. Da do thuc te:
 *    `tblao:///D:/phim/a.mp4` bi Chromium hieu "D:" la TEN MIEN -> handler nhan
 *    duong dan cut mat o dia -> trinh phat bao "Format error" (nghe nhu video
 *    hong, that ra la sai duong dan). Base64 cung mien nhiem voi ten tep co dau
 *    cach, ngoac, dau tieng Viet.
 */
const srcVideo = (p: string): string => {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(p)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `tblao://b64/${b64}`
}

type Buoc = 'idle' | 'doc' | 'dich' | 'xong' | 'loi'

export default function ScreenText({
  outputDir,
  setOutputDir
}: {
  outputDir: string
  setOutputDir: (d: string) => void
}): JSX.Element {
  const [video, setVideo] = useState<string | null>(null)
  const [videoH, setVideoH] = useState(0)
  const [videoW, setVideoW] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [vung, setVung] = useState<Region>({ y0: 0, y1: 0 })

  const [dich, setDich] = usePersistedState('tblao.ocr.dich', 'none')
  const [buoc, setBuoc] = useState<Buoc>('idle')
  const [pct, setPct] = useState(0)
  const [dongChu, setDongChu] = useState('')
  const [dangDung, setDangDung] = useState(false)
  const [ketQua, setKetQua] = useState<string[]>([])
  const [loi, setLoi] = useState<string | null>(null)

  // Buoc phu: ghep phu de vao video de dang lai
  const [videoGiay, setVideoGiay] = useState(0) // thoi luong video (canh bao srt lech)
  const [srtGiay, setSrtGiay] = useState(0) // thoi luong file .srt dang chon
  const [ghepSrt, setGhepSrt] = useState('')
  const [srtNgoai, setSrtNgoai] = useState('') // .srt user tu chon (khong qua OCR)
  const [lamMo, setLamMo] = useState(true) // lam mo phu de goc trong video
  const [coChu, setCoChu] = usePersistedState('tblao.ocr.cochu', 'auto') // co chu phu de
  const [ghepMode, setGhepMode] = useState<'burn' | 'soft'>('burn')
  const [ghep, setGhep] = useState<'idle' | 'chay' | 'xong' | 'loi'>('idle')
  const [ghepPct, setGhepPct] = useState(0)
  const [ghepOut, setGhepOut] = useState('')
  const [ghepLoi, setGhepLoi] = useState<string | null>(null)

  // Cong cu OCR tai rieng (~230MB). PHAI co man hinh tai nhu tab Douyin/Phu de,
  // khong thi user bam "Bat dau doc chu" chi thay bao do "Chua co cong cu" ma
  // KHONG co duong nao tai -> tab chet.
  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)

  const vidRef = useRef<HTMLVideoElement | null>(null)
  const unlocked = hasFeature('ocr')

  useEffect(() => {
    void window.api.ocrEngineStatus().then((s) => setHasEngine(s.has))
  }, [])

  // Do do dai file .srt dang chon -> so voi video de canh bao chon nham file
  useEffect(() => {
    if (!ghepSrt) {
      setSrtGiay(0)
      return
    }
    let huy = false
    // Boc trong Promise.resolve() de loi NEM THANG (vd preload cu chua co ham
    // nay luc dang dev) bien thanh promise bi tu choi -> .catch nuot gon.
    // Truoc day nem thang trong useEffect lam React sap TRANG CA APP.
    void Promise.resolve()
      .then(() => window.api.srtGiay(ghepSrt))
      .then((s) => {
        if (!huy) setSrtGiay(s || 0)
      })
      .catch(() => {
        if (!huy) setSrtGiay(0) // khong do duoc thi thoi, chi mat canh bao
      })
    return () => {
      huy = true
    }
  }, [ghepSrt])

  const caiCongCu = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onOcrInstallProgress(setInstallPct)
    const res = await window.api.ocrInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) setHasEngine(true)
    else setInstallErr(res.error ?? 'Tải công cụ Dịch màn hình thất bại.')
  }

  // Video vua nap xong -> biet kich thuoc that -> dat vung mac dinh 1/4 duoi
  const onMeta = (): void => {
    const v = vidRef.current
    if (!v) return
    setVideoH(v.videoHeight)
    setVideoW(v.videoWidth)
    setBoxH(v.clientHeight)
    setVideoGiay(Number.isFinite(v.duration) ? v.duration : 0)
    setVung({ y0: Math.round(v.videoHeight * 0.75), y1: v.videoHeight })
  }

  // Khung hien thi doi kich thuoc -> phai do lai he so quy doi, khong thi keo
  // khung se lech.
  // !! Dung ResizeObserver chu KHONG phai window.resize: tab nay duoc GIU SONG
  //    (an bang display:none) de khong mat video khi user qua tab khac. Luc an
  //    thi clientHeight = 0 -> he so quy doi sai. ResizeObserver bat duoc ca luc
  //    tab HIEN LAI (0 -> kich thuoc that), window.resize thi khong.
  useEffect(() => {
    const el = vidRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight
      if (h > 0) setBoxH(h) // an tab -> h=0 -> giu so cu, dung ghi de
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [video])

  const chonVideo = async (): Promise<void> => {
    const paths = await window.api.chooseFiles()
    if (!paths.length) return
    setVideo(paths[0])
    setBuoc('idle')
    setKetQua([])
    setLoi(null)
    // reset buoc ghep cho video moi
    setSrtNgoai('')
    setGhepSrt('')
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
  }

  // Nguoi dung bam Dung -> bao main giet tien trinh engine.
  // Da do that: child.kill() giet luon ca ffmpeg ma engine goi ben trong (khong
  // de lai tien trinh mo coi), va engine thoat voi ma null -> main tra ve
  // 'Da huy.'. KHONG doi sang taskkill /T: no lam engine thoat ma 1, main se
  // hieu nham la LOI va bao do len man hinh.
  const dung = async (): Promise<void> => {
    setDangDung(true)
    await window.api.ocrCancel()
  }

  const chay = async (): Promise<void> => {
    if (!video || !outputDir) return
    setBuoc('doc')
    setPct(0)
    setLoi(null)
    setKetQua([])
    setDongChu('')
    setDangDung(false)

    const off = window.api.onOcrProgress((p) => {
      setPct(p.percent)
      if (p.text) setDongChu(p.text)
    })
    const r = await window.api.ocrVideo(video, outputDir, vung.y0, vung.y1)
    off()
    setDangDung(false)

    if (!r.ok) {
      // Tu bam Dung thi khong phai loi — dung to do len lam user tuong hong
      if (r.error === 'Đã huỷ.') {
        setBuoc('idle')
        setDongChu('')
        return
      }
      setLoi(r.error ?? 'Đọc chữ thất bại.')
      setBuoc('loi')
      return
    }
    const ra = [r.output!]

    if (dich !== 'none') {
      setBuoc('dich')
      const out = r.output!.replace(/\.srt$/i, `.${dich}.srt`)
      const t = await window.api.geminiTranslateSrt(r.output!, out, dich)
      if (t.ok) ra.push(out)
      else setLoi(`Dịch: ${t.error}`)
    }
    setKetQua(ra)
    // Chuan bi buoc ghep. Mac dinh ghep BAN DICH (cuoi mang).
    // Nhay khung khoanh ve dai chu THAT engine do -> khung xem-truoc lam mo khop
    // dung, user chinh them duoc (WYSIWYG).
    if (r.bandTop != null && r.bandBot != null && r.bandBot > r.bandTop) {
      const pad = Math.round(videoH * 0.012)
      setVung({ y0: Math.max(0, r.bandTop - pad), y1: Math.min(videoH, r.bandBot + pad) })
    }
    setGhepSrt(ra[ra.length - 1])
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
    setBuoc('xong')
  }

  // Chon 1 file .srt co san (khong qua OCR) de ghep thang vao video.
  const chonSrt = async (): Promise<void> => {
    const p = await window.api.chooseSrt()
    if (!p) return
    setSrtNgoai(p)
    setGhepSrt(p)
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
  }

  // Ghep phu de vao video. Dot chet, hoac ghep mem (ranh sub). nvenc hong thi
  // burn.ts tu tut libx264.
  // KHUNG user khoanh = NOI DAT CHU (chu can giua quanh tam khung), gui KE CA
  // khi khong lam mo. Tick lam mo chi THEM nen mo vao dung vung do.
  // Sau OCR, khung da tu nhay ve dai chu that engine do (xem `chay`), user chinh
  // them duoc. Srt ngoai thi dung nguyen vung user ve.
  const ghepVideo = async (): Promise<void> => {
    if (!video || !ghepSrt || !outputDir) return
    setGhep('chay')
    setGhepPct(0)
    setGhepLoi(null)

    const coKhung = ghepMode === 'burn' && vung.y1 > vung.y0
    const off = window.api.onBurnProgress((p) => setGhepPct(p.percent < 0 ? 0 : p.percent))
    const r = await window.api.burnStart({
      video,
      srt: ghepSrt,
      outputDir,
      mode: ghepMode,
      bandTop: coKhung ? vung.y0 : null,
      bandBot: coKhung ? vung.y1 : null,
      lamMo: coKhung && lamMo,
      // Gui MUC, khong gui ti le: thang co chu video ngang/doc khac nhau, main
      // tu chon bo tham so theo huong video (ffprobe).
      coChu: coChu as CoChu,
      // Chi cat khi da canh bao lech (srt dai hon video) ma user van bam ghep
      catSrt: lechSrt === 'dai'
    })
    off()
    if (!r.ok) {
      if (r.error === 'Đã huỷ.') {
        setGhep('idle')
        return
      }
      setGhepLoi(r.error ?? 'Ghép phụ đề thất bại.')
      setGhep('loi')
      return
    }
    setGhepOut(r.output!)
    setGhep('xong')
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>

  // ----- Man cai cong cu (giong tab Douyin / Phu de) -----
  if (hasEngine === false) {
    return (
      <div className="dy-setup">
        <div className="card dy-install-card">
          <div className="dy-install-title">🔍 Cần tải công cụ Dịch màn hình</div>
          <p className="muted">
            Tính năng đọc chữ trên video chạy <b>ngay trên máy bạn</b> (không cần mạng sau khi tải,
            không gửi dữ liệu đi đâu). Bấm để tải một lần (~230MB), sau đó dùng thoải mái.
          </p>
          {installing ? (
            <>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installPct}%` }} />
              </div>
              <div className="muted small">Đang tải công cụ… {installPct}%</div>
            </>
          ) : (
            <button className="btn primary" onClick={caiCongCu}>
              Tải công cụ Dịch màn hình
            </button>
          )}
          {installErr && <div className="dy-err small">{installErr}</div>}
        </div>
      </div>
    )
  }

  const dangChay = buoc === 'doc' || buoc === 'dich'

  // Danh sach .srt co the ghep: ban OCR (dich/goc) + ban .srt co san
  const dsSrt: { path: string; nhan: string }[] = []
  if (ketQua.length > 1) {
    dsSrt.push({ path: ketQua[1], nhan: 'Bản dịch — ' })
    dsSrt.push({ path: ketQua[0], nhan: 'Bản gốc — ' })
  } else if (ketQua.length === 1) {
    dsSrt.push({ path: ketQua[0], nhan: 'Bản đọc được — ' })
  }
  if (srtNgoai && !ketQua.includes(srtNgoai)) {
    dsSrt.push({ path: srtNgoai, nhan: 'Có sẵn — ' })
  }

  // Canh bao khi .srt lech han so voi video (hay gap voi luong "chon file co san":
  // chon nham file cua video khac). Chi canh bao, VAN cho ghep — co truong hop
  // co y (vd chi lam phu de cho doan dau).
  const phut = (s: number): string => {
    const t = Math.round(s)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }
  const lechSrt: 'dai' | 'ngan' | null =
    videoGiay > 0 && srtGiay > 0
      ? srtGiay > videoGiay + 30
        ? 'dai'
        : srtGiay < videoGiay * 0.5
          ? 'ngan'
          : null
      : null

  // Xem truoc vung lam mo tren khung: chi khi da co phu de de ghep + dang bat
  // lam mo (dot chet). Khong bat luc dang khoanh vung DE DOC (can thay chu de canh).
  const xemMoVung =
    ghepMode === 'burn' && lamMo && (buoc === 'xong' || !!srtNgoai)

  return (
    <div className="lam-viec">
      {/* ---------- COT GIUA: cau hinh ---------- */}
      <div className="cot-cauhinh">
        <div className="cot-tieude">Cấu hình</div>

        <div className="card options-card">
          <button className="btn primary" onClick={chonVideo} disabled={dangChay}>
            🎞 Chọn video
          </button>
          {video && <div className="muted small ocr-ten">{baseName(video)}</div>}
          <div className="muted small">
            Dành cho video <b>chỉ có chữ chạy, không có tiếng</b> — thứ mà tab Phụ đề bó tay vì
            không có gì để nghe.
          </div>
        </div>

        <div className="card options-card">
          <label className="field">
            <span className="muted small">Thư mục lưu kết quả</span>
            <div className="gk-row">
              <input value={outputDir} readOnly />
              <button
                className="btn"
                onClick={async () => {
                  const d = await window.api.chooseFolder()
                  if (d) setOutputDir(d)
                }}
              >
                Chọn thư mục
              </button>
            </div>
          </label>
        </div>

        <GeminiKey dich={dich} setDich={setDich} />

        {video && (
          <div className="card">
            <div className="cookie-actions">
              {!dangChay && (
                <button className="btn primary" disabled={!outputDir} onClick={chay}>
                  ▶ Bắt đầu đọc chữ
                </button>
              )}
              {buoc === 'doc' && (
                <button className="btn danger" onClick={dung} disabled={dangDung}>
                  {dangDung ? 'Đang dừng…' : '■ Dừng'}
                </button>
              )}
              {buoc === 'doc' && <span className="cookie-status ok">Đang đọc… {pct}%</span>}
              {/* Buoc dich la 1 lan goi mang, khong giet giua chung duoc -> khong co nut Dung */}
              {buoc === 'dich' && <span className="cookie-status ok">✨ Đang dịch…</span>}
            </div>
            {dangChay && (
              <>
                <div className="bar" style={{ marginTop: 10, height: 8 }}>
                  <div className="bar-fill" style={{ width: `${buoc === 'dich' ? 100 : pct}%` }} />
                </div>
                {dongChu && <div className="muted small ocr-dong">{dongChu}</div>}
              </>
            )}
            {loi && <div className="dy-err small">{loi}</div>}
            {buoc === 'xong' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ✅ Xong ·{' '}
                {ketQua.map((o) => (
                  <button key={o} className="link-btn" onClick={() => window.api.showItem(o)}>
                    {baseName(o)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Buoc PHU (opt-in): ghep phu de vao video de dang lai ----
            Hien khi co video. 2 luong: (1) sau khi doc chu -> ghep ban .srt/dich;
            (2) chon THANG file .srt co san, khong can OCR. */}
        {video && (
          <div className="card options-card">
            <div className="cot-tieude">Ghép phụ đề vào video</div>
            <div className="muted small">
              Gắn phụ đề vào video để <b>đăng lại</b>, có thể <b>làm mờ phụ đề gốc</b>. Dùng bản
              vừa đọc/dịch ở trên, hoặc chọn file phụ đề (.srt) có sẵn.
            </div>

            <button className="btn" onClick={chonSrt}>
              📄 Dùng file phụ đề (.srt) có sẵn
            </button>

            {dsSrt.length === 0 ? (
              <div className="muted small">
                Chưa có phụ đề — đọc chữ ở trên hoặc chọn file phụ đề (.srt) có sẵn.
              </div>
            ) : (
              <>
                {dsSrt.length > 1 && (
                  <label className="field">
                    <span className="muted small">Ghép phụ đề nào</span>
                    <select value={ghepSrt} onChange={(e) => setGhepSrt(e.target.value)}>
                      {dsSrt.map((o) => (
                        <option key={o.path} value={o.path}>
                          {o.nhan}
                          {baseName(o.path)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {lechSrt && (
                  <div className="qwarn small">
                    ⚠ File phụ đề dài <b>{phut(srtGiay)}</b>, video dài <b>{phut(videoGiay)}</b>
                    {lechSrt === 'dai'
                      ? ' — phần phụ đề vượt quá thời lượng video sẽ không hiện.'
                      : ' — phụ đề chỉ phủ được phần đầu video.'}{' '}
                    Có thể bạn chọn nhầm file?
                    {lechSrt === 'dai' && ghepMode === 'soft' && (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        Nếu vẫn ghép, phần phụ đề thừa sẽ được <b>cắt bỏ</b> cho vừa video.
                      </div>
                    )}
                  </div>
                )}

                <label className="field">
                  <span className="muted small">Cách gắn phụ đề</span>
                  <select
                    value={ghepMode}
                    onChange={(e) => setGhepMode(e.target.value as 'burn' | 'soft')}
                  >
                    <option value="burn">Gắn cố định vào hình (đăng lại đâu cũng còn)</option>
                    <option value="soft">Phụ đề rời, bật/tắt được (chỉ xem trên máy)</option>
                  </select>
                </label>

                {ghepMode === 'burn' && (
                  <>
                    <label className="field">
                      <span className="muted small">Cỡ chữ</span>
                      <select value={coChu} onChange={(e) => setCoChu(e.target.value)}>
                        <option value="auto">Tự động (theo khung)</option>
                        <option value="nho">Nhỏ</option>
                        <option value="vua">Vừa</option>
                        <option value="lon">Lớn</option>
                        <option value="ratlon">Rất lớn</option>
                      </select>
                    </label>
                    <label className="gk-check">
                      <input type="checkbox" checked={lamMo} onChange={(e) => setLamMo(e.target.checked)} />
                      <span>
                        Làm mờ phụ đề gốc{' '}
                        <span className="muted small">(thêm nền mờ vào đúng khung bên phải)</span>
                      </span>
                    </label>
                    <div className="muted small">
                      💡 <b>Khung bên phải là chỗ đặt chữ</b> — kéo khung tới đâu, phụ đề mới nằm
                      giữa đó. Ô trên chỉ quyết định có làm mờ nền hay không.
                    </div>
                  </>
                )}

                <div className="cookie-actions">
                  {ghep !== 'chay' && (
                    <button className="btn primary" disabled={!ghepSrt} onClick={ghepVideo}>
                      🎬 Ghép vào video
                    </button>
                  )}
                  {ghep === 'chay' && (
                    <>
                      <button className="btn danger" onClick={() => window.api.burnCancel()}>
                        ■ Dừng
                      </button>
                      <span className="cookie-status ok">Đang ghép… {ghepPct}%</span>
                    </>
                  )}
                </div>
                {ghep === 'chay' && (
                  <div className="bar" style={{ marginTop: 10, height: 8 }}>
                    <div className="bar-fill" style={{ width: `${ghepPct}%` }} />
                  </div>
                )}
                {ghep === 'chay' && ghepMode === 'burn' && (
                  <div className="muted small" style={{ marginTop: 6 }}>
                    Đang gắn phụ đề vào hình nên hơi lâu — video dài có thể vài phút.
                  </div>
                )}
                {ghepLoi && <div className="dy-err small">{ghepLoi}</div>}
                {ghep === 'xong' && (
                  <div className="muted small" style={{ marginTop: 8 }}>
                    ✅ Đã ghép ·{' '}
                    <button className="link-btn" onClick={() => window.api.showItem(ghepOut)}>
                      {baseName(ghepOut)}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ---------- COT PHAI: video + khung khoanh vung ---------- */}
      <div className="cot-ketqua cot-video">
        <div className="cot-tieude">Video &amp; vùng chữ</div>
        {video ? (
          <>
            <div className="muted small">
              Kéo khung để trùm lên <b>chỗ chữ chạy</b>. Kéo mép trên/dưới để co giãn. Chữ ngoài
              khung (logo, tiêu đề, watermark) sẽ bị bỏ qua.
            </div>
            <div className="ocr-sanh">
              {/* aspect-ratio = ti le THAT cua video -> khung tu co vua o xem,
                  video doc khong con tran ra ngoai. Chua biet kich thuoc (chua
                  nap xong) thi de trong, khoi nhay giat. */}
              <div
                className="ocr-video"
                style={videoW > 0 && videoH > 0 ? { aspectRatio: `${videoW} / ${videoH}` } : undefined}
              >
                <video
                  ref={vidRef}
                  src={srcVideo(video)}
                  onLoadedMetadata={onMeta}
                  onError={() => setLoi('Không mở được video này. Thử định dạng khác (mp4/webm).')}
                  controls
                  muted
                />
                {videoH > 0 && (
                  <RegionBox
                    vung={vung}
                    setVung={setVung}
                    videoH={videoH}
                    boxH={boxH}
                    xemMo={xemMoVung}
                  />
                )}
              </div>
            </div>
            {videoH > 0 && (
              <div className="muted small ocr-toado">
                Video {videoW}×{videoH} · {xemMoVung ? 'vùng làm mờ' : 'vùng đang chọn'}:{' '}
                {vung.y0} → {vung.y1} px
              </div>
            )}
          </>
        ) : (
          <div className="ocr-sanh">
            <div className="muted small">Chưa chọn video — bấm “Chọn video” bên trái.</div>
          </div>
        )}
      </div>
    </div>
  )
}
