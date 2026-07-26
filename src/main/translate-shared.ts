import { DICH_LANGS, type SrtBlock } from '../shared/types'

/** Gioi han ky tu moi chunk gui AI. */
export const MAX_CHARS = 20000

/** Prompt he thong dung chung cho moi nha cung cap. */
export function huongDan(ma: string): string {
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
export function chia(blocks: SrtBlock[]): SrtBlock[][] {
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
