// Móc kiểm tra quyền tính năng (license).
// HIỆN TẠI: luôn trả về true để phát triển/test tự do (2 tab premium chạy FREE tạm).
// SAU NÀY: nối vào "vé" đã ký số từ server — chỉ cần sửa DUY NHẤT hàm này,
// KHÔNG phải đụng vào ruột các tab. Xem thiết kế license đã đóng băng.
//
// Quy ước feature key: 'audio2text' (tab Audio→Text), 'ocr' (tab OCR).

export type FeatureKey = 'audio2text' | 'ocr'

export function hasFeature(_key: FeatureKey): boolean {
  return true
}
