import type { SiteId } from './sites'

export type YtDlpErrorCode =
  | 'facebook_parse_failed'
  | 'impersonation_unavailable'
  | 'bilibili_412'
  | 'login_required'
  | 'premium_required'
  | 'geo_restricted'
  | 'format_unavailable'
  | 'rate_limited'
  | 'service_unavailable'
  | 'content_unavailable'
  | 'network_error'
  | 'permission_denied'
  | 'disk_full'
  | 'missing_dependency'
  | 'unknown'

export interface YtDlpErrorInfo {
  code: YtDlpErrorCode
  site: SiteId
  message: string
}

export interface ClassifyYtDlpOptions {
  /** false khi probe xac nhan binary khong co curl_cffi/target tuong duong. */
  impersonationAvailable?: boolean
}

/** Phan loai stderr truoc khi rut gon; khong tra lai URL, cookie hay traceback. */
export function classifyYtDlpError(
  site: SiteId,
  raw: unknown,
  options: ClassifyYtDlpOptions = {}
): YtDlpErrorInfo {
  const text = raw instanceof Error ? raw.message : String(raw ?? '')

  if (/impersonate target .*not available|missing dependencies.*impersonat/i.test(text)) {
    return {
      code: 'impersonation_unavailable',
      site,
      message: 'Công cụ tải chưa hỗ trợ mô phỏng trình duyệt. Hãy cập nhật hoặc cài lại công cụ tải.'
    }
  }

  if (site === 'facebook' && /cannot parse data/i.test(text)) {
    if (options.impersonationAvailable === false) {
      return {
        code: 'impersonation_unavailable',
        site,
        message: 'Công cụ tải thiếu mô phỏng trình duyệt cần cho Facebook. Hãy cập nhật hoặc cài lại công cụ tải.'
      }
    }
    return {
      code: 'facebook_parse_failed',
      site,
      message: 'Facebook chưa cho phép đọc video này. Hãy đăng nhập Facebook; nếu vẫn lỗi thì extractor hiện chưa hỗ trợ URL này.'
    }
  }

  if (
    site === 'facebook' &&
    /checkpoint|HTTP Error 403|\b403 Forbidden\b|temporarily blocked|suspicious (?:activity|login)/i.test(text)
  ) {
    return {
      code: 'login_required',
      site,
      message: 'Facebook từ chối phiên truy cập. Hãy đăng nhập lại Facebook; nếu vẫn lỗi, hãy thử cùng IP hoặc tắt/đổi proxy.'
    }
  }

  if (site === 'bilibili' && /HTTP Error 412|Precondition Failed/i.test(text)) {
    return {
      code: 'bilibili_412',
      site,
      message: 'Bilibili từ chối yêu cầu phát video (HTTP 412). Hãy thử lại sau hoặc đổi IP/proxy.'
    }
  }

  if (/premium member|premium-only|supporter-only|members?.?only|大会员/i.test(text)) {
    return {
      code: 'premium_required',
      site,
      message: 'Nội dung hoặc chất lượng này yêu cầu tài khoản thành viên/Premium.'
    }
  }
  if (/sign in|log in|login required|cookies? (?:are )?required|private video|registered users/i.test(text)) {
    return { code: 'login_required', site, message: 'Cần đăng nhập website này mới tải được nội dung.' }
  }
  if (/geo.?restrict|not available in your (?:country|region)|blocked.*(?:region|country)|\bcountry\b/i.test(text)) {
    return { code: 'geo_restricted', site, message: 'Nội dung bị giới hạn theo khu vực.' }
  }
  if (/requested format is not available|no video formats found|format.*(?:missing|unavailable)/i.test(text)) {
    return {
      code: 'format_unavailable',
      site,
      message: 'Định dạng hoặc độ phân giải đã chọn không khả dụng. Hãy chọn chất lượng khác.'
    }
  }
  if (/\b429\b|too many requests|rate.?limit/i.test(text)) {
    return { code: 'rate_limited', site, message: 'Website đang giới hạn lượt truy cập. Hãy thử lại sau.' }
  }
  if (/HTTP Error 503|Service Unavailable|temporarily unavailable/i.test(text)) {
    return {
      code: 'service_unavailable',
      site,
      message: 'Máy chủ website đang tạm thời không phục vụ (HTTP 503). Hãy thử lại sau.'
    }
  }
  if (
    /video unavailable|content (?:is not|isn't|is no longer|not) available|content unavailable|removed|deleted|does not exist|HTTP Error 404/i.test(
      text
    )
  ) {
    return { code: 'content_unavailable', site, message: 'Nội dung không còn khả dụng.' }
  }
  if (/ENOSPC|disk.?full|no space/i.test(text)) {
    return { code: 'disk_full', site, message: 'Ổ đĩa đã đầy.' }
  }
  if (
    /ENOENT|not found|no such file|không tìm thấy (?:công cụ tải|bộ tải xuống)|khong tim thay (?:yt-dlp|bo tai xuong)/i.test(
      text
    )
  ) {
    return { code: 'missing_dependency', site, message: 'Thiếu tệp hoặc công cụ cần thiết.' }
  }
  if (/EACCES|EPERM|permission denied/i.test(text)) {
    return { code: 'permission_denied', site, message: 'Không đủ quyền đọc hoặc ghi tệp.' }
  }
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|timed? ?out|ETIMEDOUT/i.test(text)) {
    return { code: 'network_error', site, message: 'Lỗi kết nối mạng hoặc máy chủ không phản hồi.' }
  }

  return { code: 'unknown', site, message: 'Không xác định được nguyên nhân tải thất bại.' }
}

export function shouldRetryWithoutCookies(site: SiteId, raw: unknown): boolean {
  if (site !== 'youtube') return false
  return /HTTP Error 403|\b403 Forbidden\b/i.test(String(raw ?? ''))
}
