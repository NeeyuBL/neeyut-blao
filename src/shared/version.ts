/** So sánh version ứng dụng dạng x.y.z; fail-closed với chuỗi không hợp lệ. */
export function isNewerAppVersion(candidate: string, current: string): boolean {
  const parse = (value: string): number[] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
    return match ? match.slice(1).map(Number) : null
  }
  const next = parse(candidate)
  const now = parse(current)
  if (!next || !now) return false
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index]
  }
  return false
}
