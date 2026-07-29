# Font phụ đề (resources/fonts)

## Chính sách repo công khai

**Không** commit file `.ttf` / `.otf` lên GitHub.

| Nhóm | Số lượng (hiện tại) | Vì sao không đẩy |
|------|---------------------|------------------|
| UTM / SVN / UVF / UVN / VNF / iCiel | ~75 | Thường là font thương mại / giấy phép redistrib không rõ |
| Windows stock (Arial, Tahoma, …) | 11 | EULA Microsoft — không được redistribute trong repo |

Repo chỉ giữ:

- `catalog.json` — danh sách id/label/file mà app đọc
- `README.md` (file này)

## Build local / đóng gói App

1. Giữ bộ font nguồn trong thư mục `font/` (đã `.gitignore`, không public).
2. Chạy `npm run fonts:copy` → copy curated vào `resources/fonts/` + ghi `catalog.json`.
3. `electron-builder` bundle qua `extraResources` → installer App có font; **không** cần font trên GitHub để user cuối dùng bản cài.

## Contributor

Không có binary font: tab burn có thể thiếu dropdown font cho đến khi bạn tự bổ sung `font/` + `npm run fonts:copy`.
