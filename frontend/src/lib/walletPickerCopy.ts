const en = {
  detected: 'Detected',
  absent: 'Not detected',
  connecting: 'Connecting…',
  connected: 'Connected',
  none: 'No browser wallet detected. You can still watch a public address.',
  choose: 'Choose your wallet. It will ask you to connect and switch to Arc Testnet.',
  cancelled: 'Connection cancelled.',
  failed: 'Connection did not complete. Try again in your wallet.',
  address: 'Public Arc address',
  watch: 'Watch address',
  other: 'Other browser wallet',
} as const
const vi: Record<keyof typeof en, string> = {
  detected: 'Đã phát hiện',
  absent: 'Chưa phát hiện',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  none: 'Chưa phát hiện ví trình duyệt. Bạn vẫn có thể theo dõi địa chỉ công khai.',
  choose: 'Chọn ví của bạn. Ví sẽ yêu cầu kết nối và chuyển sang Arc Testnet.',
  cancelled: 'Đã hủy kết nối.',
  failed: 'Kết nối chưa hoàn tất. Hãy thử lại trong ví của bạn.',
  address: 'Địa chỉ Arc công khai',
  watch: 'Chỉ xem địa chỉ',
  other: 'Ví trình duyệt khác',
}
export const walletPickerCopy = (locale: string) => locale === 'vi' ? vi : en
