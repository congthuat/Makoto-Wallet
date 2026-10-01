export type TaskLanguage = 'en' | 'vi'

const copy = {
  active: ['Active', 'Đang chạy'], paused: ['Paused', 'Tạm dừng'], triggered: ['Triggered', 'Đã kích hoạt'],
  completed: ['Completed', 'Hoàn tất'], failed: ['Failed', 'Thất bại'], blocked: ['Blocked', 'Đã chặn'],
  monitor: ['Monitor', 'Theo dõi'], automation: ['Automation', 'Tự động'],
  condition: ['Condition', 'Điều kiện'], schedule: ['Schedule', 'Lịch chạy'], account: ['Account', 'Ví'],
  chain: ['Network', 'Mạng'], timezone: ['Timezone', 'Múi giờ'], check: ['Check cadence', 'Chu kỳ kiểm tra'],
  next: ['Next run/check', 'Lần chạy/kiểm tra tiếp theo'], last: ['Last run/check', 'Lần chạy/kiểm tra cuối'],
  localTime: ['Local time', 'Giờ địa phương'], localTimeSuffix: ['local time', 'giờ địa phương'],
  timezoneUnavailable: ['Timezone unavailable', 'Múi giờ chưa khả dụng'], offsetUnavailable: ['UTC offset unavailable', 'Độ lệch UTC chưa khả dụng'],
  result: ['Latest result', 'Kết quả gần nhất'], error: ['Last error', 'Lỗi gần nhất'],
  languageSummary: ['Makoto summary', 'Makoto tóm tắt'], providerSummary: ['AI phrasing', 'Diễn đạt bằng AI'], localSummary: ['Local summary', 'Tóm tắt cục bộ'],
  prices: ['Observed unit prices', 'Giá đơn vị quan sát được'],
  never: ['Never', 'Chưa có'], none: ['None', 'Không có'],
  otherAccount: ['Belongs to another account', 'Thuộc ví khác'],
  backendOffline: ['Task service is unavailable. Tasks only run while the backend process is on.', 'Dịch vụ nhiệm vụ không khả dụng. Nhiệm vụ chỉ chạy khi máy chủ đang bật.'],
  backendLocal: ['Tasks run only while this backend is running. The browser can be closed.', 'Nhiệm vụ chỉ chạy khi máy chủ này đang bật. Có thể đóng trình duyệt.'],
  connectFirst: ['Connect a wallet or watch a public Arc address first.', 'Hãy kết nối ví hoặc theo dõi một địa chỉ Arc công khai trước.'],
  chainFirst: ['Switch the connected wallet to Arc Testnet first.', 'Hãy chuyển ví sang Arc Testnet trước.'],
  unsupported: ['This task request needs more detail or is unsupported.', 'Yêu cầu nhiệm vụ cần thêm chi tiết hoặc chưa được hỗ trợ.'],
  writeBoundary: ['Financial actions can only be prepared. Review, policy checks, and your wallet signature are required before any transaction.', 'Hành động tài chính chỉ được chuẩn bị. Mọi giao dịch cần xem lại, kiểm tra chính sách và chữ ký ví của bạn.'],
  review: ['Review task', 'Xem lại nhiệm vụ'], create: ['Create task', 'Tạo nhiệm vụ'],
  duplicate: ['An identical task already exists. Edit the existing task instead.', 'Đã có nhiệm vụ giống hệt. Hãy sửa nhiệm vụ hiện có.'],
  noSignature: ['Creating this background task does not ask for a wallet signature. No transaction will run automatically.', 'Tạo nhiệm vụ nền này không cần chữ ký ví. Không giao dịch nào được chạy tự động.'],
  created: ['Task created.', 'Đã tạo nhiệm vụ.'], updated: ['Task updated.', 'Đã cập nhật nhiệm vụ.'],
  removed: ['Task removed.', 'Đã xóa nhiệm vụ.'], ran: ['Task checked.', 'Đã kiểm tra nhiệm vụ.'],
  pause: ['Pause', 'Tạm dừng'], resume: ['Resume', 'Tiếp tục'], edit: ['Edit', 'Sửa'],
  remove: ['Delete', 'Xóa'], runNow: ['Run now', 'Chạy ngay'], cancel: ['Cancel', 'Hủy'], save: ['Save changes', 'Lưu thay đổi'],
  all: ['All', 'Tất cả'], alerts: ['Alert history', 'Lịch sử thông báo'], noAlerts: ['No task notifications yet.', 'Chưa có thông báo nhiệm vụ.'],
  noTasks: ['No tasks yet.', 'Chưa có nhiệm vụ.'], description: ['Description', 'Mô tả'], title: ['Title', 'Tên nhiệm vụ'],
  threshold: ['Threshold', 'Ngưỡng'], time: ['Daily time', 'Giờ hằng ngày'],
  type: ['Type', 'Loại'], details: ['Definition', 'Định nghĩa'],
  missing: ['Missing details', 'Thiếu thông tin'], retry: ['Retry', 'Thử lại'],
  preparing: ['Preparing task proposal…', 'Đang chuẩn bị đề xuất nhiệm vụ…'],
  confirmDelete: ['Delete this persistent task?', 'Xóa nhiệm vụ đã lưu này?'],
  noResult: ['No result yet', 'Chưa có kết quả'],
  verifyWallet: ['Verify wallet to manage tasks', 'X\u00e1c minh v\u00ed \u0111\u1ec3 qu\u1ea3n l\u00fd nhi\u1ec7m v\u1ee5'],
  verifyDetails: ['Sign a message to prove wallet ownership. No gas or transaction is involved.', 'K\u00fd th\u00f4ng \u0111i\u1ec7p \u0111\u1ec3 ch\u1ee9ng minh quy\u1ec1n s\u1edf h\u1eefu v\u00ed. Kh\u00f4ng t\u1ed1n ph\u00ed gas hay t\u1ea1o giao d\u1ecbch.'],
  verifyMismatch: ['Your connected wallet differs from the task session. Verify the current wallet.', 'V\u00ed \u0111ang k\u1ebft n\u1ed1i kh\u00e1c v\u1edbi phi\u00ean nhi\u1ec7m v\u1ee5. H\u00e3y x\u00e1c minh v\u00ed hi\u1ec7n t\u1ea1i.'],
  verifyConnect: ['Connect a wallet to manage tasks. Watch-only addresses cannot verify ownership.', 'K\u1ebft n\u1ed1i v\u00ed \u0111\u1ec3 qu\u1ea3n l\u00fd nhi\u1ec7m v\u1ee5. \u0110\u1ecba ch\u1ec9 theo d\u00f5i kh\u00f4ng th\u1ec3 x\u00e1c minh.'],
  verifiedWallet: ['Wallet verified for tasks', '\u0110\u00e3 x\u00e1c minh v\u00ed cho nhi\u1ec7m v\u1ee5'],
  taskLogout: ['Sign out of tasks', '\u0110\u0103ng xu\u1ea5t nhi\u1ec7m v\u1ee5'],
  taskCreationNote: ['Task creation never signs a transaction. Wallet verification uses a message signature once per session.', 'T\u1ea1o nhi\u1ec7m v\u1ee5 kh\u00f4ng k\u00fd giao d\u1ecbch. X\u00e1c minh v\u00ed d\u00f9ng ch\u1eef k\u00fd th\u00f4ng \u0111i\u1ec7p m\u1ed9t l\u1ea7n cho m\u1ed7i phi\u00ean.'],
} as const

export type TaskTextKey = keyof typeof copy
export function taskText(key: TaskTextKey, locale: TaskLanguage): string { return copy[key][locale === 'vi' ? 1 : 0] }
export function taskDate(value: string | null | undefined, locale: TaskLanguage, timezone?: string): string {
  if (!value) return taskText('never', locale)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  try { return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(date) }
  catch { return date.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') }
}
