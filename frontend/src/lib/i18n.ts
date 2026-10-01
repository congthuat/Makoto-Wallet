import { useSyncExternalStore } from 'react'
import { EXTRA } from './i18n-extra'
import { PAGES_I18N } from './i18n-pages'

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
] as const
export type Lang = (typeof LANGS)[number]['code']

/** English source string → [vi, zh, ja, ko]. Missing keys fall back to English. */
const DICT: Record<string, [string, string, string, string]> = {
  // Navigation
  DISCOVER: ['KHÁM PHÁ', '探索', '探索', '탐색'],
  WALLET: ['VÍ', '钱包', 'ウォレット', '지갑'],
  TRADE: ['GIAO DỊCH', '交易', '取引', '거래'],
  TRANSACTIONS: ['GIAO DỊCH', '交易', '取引', '거래'],
  'Get test tokens': ['Nhận token', '领取测试代币', 'テストトークンを受け取る', '테스트 토큰 받기'],
  Home: ['Trang chủ', '首页', 'ホーム', '홈'],
  Agent: ['Trợ lý', '助手', 'エージェント', '에이전트'],
  Tasks: ['Nhiệm vụ', '任务', 'タスク', '작업'],
  Portfolio: ['Danh mục', '资产组合', 'ポートフォリオ', '포트폴리오'],
  Assets: ['Tài sản', '资产', '資産', '자산'],
  Activity: ['Hoạt động', '活动', 'アクティビティ', '활동'],
  Send: ['Gửi', '发送', '送金', '보내기'],
  Receive: ['Nhận', '接收', '受取', '받기'],
  Swap: ['Hoán đổi', '兑换', 'スワップ', '스왑'],
  Bridge: ['Chuyển chuỗi', '跨链', 'ブリッジ', '브리지'],
  Wallet: ['Ví', '钱包', 'ウォレット', '지갑'],
  Feedback: ['Góp ý', '反馈', 'フィードバック', '피드백'],
  Settings: ['Cài đặt', '设置', '設定', '설정'],
  Help: ['Trợ giúp', '帮助', 'ヘルプ', '도움말'],
  Insights: ['Phân tích', '洞察', 'インサイト', '인사이트'],
  // Header / banner
  'Search assets or paste an address': ['Tìm tài sản hoặc dán địa chỉ', '搜索资产或粘贴地址', '資産を検索またはアドレスを貼り付け', '자산 검색 또는 주소 붙여넣기'],
  'Connect wallet': ['Kết nối ví', '连接钱包', 'ウォレット接続', '지갑 연결'],
  Connect: ['Kết nối', '连接', '接続', '연결'],
  Demo: ['Mẫu', '演示', 'デモ', '데모'],
  // Agent hero
  'Makoto Agent · design preview on Arc Testnet': ['Makoto Agent · bản xem trước trên Arc Testnet', 'Makoto 助手 · Arc 测试网设计预览', 'Makoto エージェント · Arc テストネットのデザインプレビュー', 'Makoto 에이전트 · Arc 테스트넷 디자인 미리보기'],
  'Good morning.': ['Chào buổi sáng.', '早上好。', 'おはようございます。', '좋은 아침입니다.'],
  'Good afternoon.': ['Chào buổi chiều.', '下午好。', 'こんにちは。', '좋은 오후입니다.'],
  'Good evening.': ['Chào buổi tối.', '晚上好。', 'こんばんは。', '좋은 저녁입니다.'],
  'What should Makoto do': ['Makoto có thể làm gì', 'Makoto 能为你做', 'Makoto は何を', 'Makoto가 무엇을'],
  'for you?': ['cho bạn?', '什么？', 'しましょうか？', '해드릴까요?'],
  'Ask about your wallet, preview monitoring tasks, or set up alerts — in plain language.': [
    'Hỏi về ví của bạn, xem trước nhiệm vụ theo dõi hoặc tạo cảnh báo — bằng ngôn ngữ tự nhiên.',
    '用自然语言询问钱包、预览监控任务或设置提醒。',
    'ウォレットについて質問したり、監視タスクのプレビューやアラート設定を自然な言葉で。',
    '지갑에 대해 묻고, 모니터링 작업을 미리 보고, 알림을 설정하세요 — 자연스러운 말로.',
  ],
  Ask: ['Hỏi', '提问', '質問', '질문'],
  Monitor: ['Theo dõi', '监控', '監視', '모니터'],
  Automate: ['Tự động', '自动化', '自動化', '자동화'],
  'Ask anything… e.g. “What is my portfolio worth?”': ['Hỏi bất cứ điều gì… ví dụ “Danh mục của tôi trị giá bao nhiêu?”', '随便问… 例如“我的资产值多少？”', '何でも質問… 例：「ポートフォリオの価値は？」', '무엇이든 물어보세요… 예: “내 포트폴리오 가치는?”'],
  'Try a sample: “Alert me when USDC balance is below 500”': ['Thử mẫu: “Báo tôi khi số dư USDC dưới 500”', '试试示例：“USDC 余额低于 500 时提醒我”', 'サンプル：「USDC 残高が 500 未満になったら通知」', '샘플: “USDC 잔액이 500 미만이면 알려줘”'],
  'Try a sample: “Send me a daily portfolio summary at 08:00”': ['Thử mẫu: “Gửi tóm tắt danh mục mỗi ngày lúc 08:00”', '试试示例：“每天 08:00 发送资产摘要”', 'サンプル：「毎日 08:00 にポートフォリオ概要を送信」', '샘플: “매일 08:00에 포트폴리오 요약 보내줘”'],
  'What is my portfolio worth?': ['Danh mục của tôi trị giá bao nhiêu?', '我的资产值多少？', 'ポートフォリオの価値は？', '내 포트폴리오 가치는?'],
  'Show my last transactions': ['Xem giao dịch gần đây', '查看最近交易', '最近の取引を表示', '최근 거래 보기'],
  'Send 10 EURC to 0x1234…7890': ['Gửi 10 EURC tới 0x1234…7890', '发送 10 EURC 至 0x1234…7890', '0x1234…7890 に 10 EURC 送金', '0x1234…7890에 10 EURC 보내기'],
  'Swap 20 USDC to EURC': ['Đổi 20 USDC sang EURC', '将 20 USDC 兑换为 EURC', '20 USDC を EURC にスワップ', '20 USDC를 EURC로 스왑'],
  'Bridge 10 USDC to Base Sepolia': ['Chuyển 10 USDC sang Base Sepolia', '跨链 10 USDC 至 Base Sepolia', '10 USDC を Base Sepolia へブリッジ', '10 USDC를 Base Sepolia로 브리지'],
  'Alert me when USDC balance is below 500': ['Báo tôi khi số dư USDC dưới 500', 'USDC 余额低于 500 时提醒我', 'USDC 残高が 500 未満で通知', 'USDC 잔액이 500 미만이면 알림'],
  'Watch my wallet activity': ['Theo dõi hoạt động ví của tôi', '关注我的钱包活动', 'ウォレットの動きを監視', '내 지갑 활동 보기'],
  'Send me a daily portfolio summary at 08:00': ['Gửi tóm tắt danh mục mỗi ngày lúc 08:00', '每天 08:00 发送资产摘要', '毎日 08:00 にポートフォリオ概要', '매일 08:00 포트폴리오 요약'],
  'Sample scenarios · you review every step. Transactions are authorized by your wallet.': [
    'Kịch bản mẫu · bạn xem lại từng bước. Giao dịch được ví của bạn phê duyệt.',
    '示例场景 · 每一步由你确认。交易由你的钱包授权。',
    'サンプルシナリオ · 各ステップを確認できます。取引はウォレットで承認されます。',
    '샘플 시나리오 · 모든 단계를 직접 확인합니다. 거래는 지갑에서 승인됩니다.',
  ],
  'Makoto will propose a task for you to review.': ['Makoto sẽ đề xuất một nhiệm vụ để bạn xem lại.', 'Makoto 会提出任务供你确认。', 'Makoto が確認用のタスクを提案します。', 'Makoto가 검토할 작업을 제안합니다.'],
  // Home cards
  'Total balance': ['Tổng số dư', '总余额', '総残高', '총 잔액'],
  'Sample data': ['Dữ liệu mẫu', '示例数据', 'サンプルデータ', '샘플 데이터'],
  'Sample tasks · preview of the future experience': ['Nhiệm vụ mẫu · xem trước trải nghiệm tương lai', '示例任务 · 未来体验预览', 'サンプルタスク · 今後の体験のプレビュー', '샘플 작업 · 향후 경험 미리보기'],
  'View all tasks': ['Xem tất cả nhiệm vụ', '查看全部任务', 'すべてのタスク', '모든 작업 보기'],
  'All assets': ['Tất cả tài sản', '全部资产', 'すべての資産', '모든 자산'],
  'Recent activity': ['Hoạt động gần đây', '最近活动', '最近のアクティビティ', '최근 활동'],
  'View all': ['Xem tất cả', '查看全部', 'すべて表示', '모두 보기'],
  All: ['Tất cả', '全部', 'すべて', '전체'],
  'Arc Chain Pulse': ['Nhịp mạng Arc', 'Arc 链状态', 'Arc チェーン状況', 'Arc 체인 현황'],
  Network: ['Mạng', '网络', 'ネットワーク', '네트워크'],
  'RPC latency': ['Độ trễ RPC', 'RPC 延迟', 'RPC 遅延', 'RPC 지연'],
  'Latest block': ['Khối mới nhất', '最新区块', '最新ブロック', '최신 블록'],
  'Est. network fee': ['Phí mạng ước tính', '预估网络费', '推定ネットワーク手数料', '예상 네트워크 수수료'],
  Online: ['Trực tuyến', '在线', 'オンライン', '온라인'],
  Unavailable: ['Không khả dụng', '不可用', '利用不可', '사용 불가'],
  'Arc network': ['Mạng Arc', 'Arc 网络', 'Arc ネットワーク', 'Arc 네트워크'],
  'Gas is paid in USDC': ['Phí gas trả bằng USDC', 'Gas 以 USDC 支付', 'ガス代は USDC で支払い', '가스비는 USDC로 지불'],
  // Page headers
  Preferences: ['Tùy chọn', '偏好', '環境設定', '환경설정'],
  'Settings are stored on this device only.': ['Cài đặt chỉ được lưu trên thiết bị này.', '设置仅保存在此设备上。', '設定はこの端末にのみ保存されます。', '설정은 이 기기에만 저장됩니다.'],
  'Things Makoto will monitor or automate for you. This preview shows the future experience with sample tasks.': [
    'Những việc Makoto sẽ theo dõi hoặc tự động hóa cho bạn. Bản xem trước này dùng nhiệm vụ mẫu.',
    'Makoto 将为你监控或自动化的事项。此预览使用示例任务。',
    'Makoto が監視・自動化する項目です。このプレビューはサンプルタスクを使用しています。',
    'Makoto가 모니터링하거나 자동화할 항목입니다. 이 미리보기는 샘플 작업을 사용합니다.',
  ],
  'Review transaction': ['Xem lại giao dịch', '确认交易', '取引を確認', '거래 검토'],
  'Bridge USDC': ['Chuyển chuỗi USDC', '跨链 USDC', 'USDC ブリッジ', 'USDC 브리지'],
  'Cross-chain': ['Liên chuỗi', '跨链', 'クロスチェーン', '크로스체인'],
  Trade: ['Giao dịch', '交易', '取引', '거래'],
  'Design preview': ['Bản xem trước', '设计预览', 'デザインプレビュー', '디자인 미리보기'],
  Prototype: ['Nguyên mẫu', '原型', 'プロトタイプ', '프로토타입'],
  // Settings
  Display: ['Hiển thị', '显示', '表示', '표시'],
  App: ['Ứng dụng', '应用', 'アプリ', '앱'],
  'Address book': ['Danh bạ', '地址簿', 'アドレス帳', '주소록'],
  About: ['Thông tin', '关于', '概要', '정보'],
  Language: ['Ngôn ngữ', '语言', '言語', '언어'],
  Theme: ['Giao diện', '主题', 'テーマ', '테마'],
  'Hide balances': ['Ẩn số dư', '隐藏余额', '残高を隠す', '잔액 숨기기'],
  'Mask amounts across the app': ['Che số tiền trong toàn ứng dụng', '在整个应用中隐藏金额', 'アプリ全体で金額を隠す', '앱 전체에서 금액 가리기'],
  'Hide balances under $1': ['Ẩn số dư dưới $1', '隐藏低于 $1 的余额', '$1 未満の残高を隠す', '$1 미만 잔액 숨기기'],
  'Hide unverified tokens': ['Ẩn token chưa xác minh', '隐藏未验证代币', '未確認トークンを隠す', '미확인 토큰 숨기기'],
  'Filter unknown airdropped tokens': ['Lọc token airdrop không rõ nguồn', '过滤未知空投代币', '不明なエアドロップを除外', '알 수 없는 에어드롭 토큰 필터'],
  'Signing & keys': ['Ký & khóa', '签名与密钥', '署名と鍵', '서명 및 키'],
  'Transactions are authorized by your wallet. Makoto does not store private keys.': [
    'Giao dịch được ví của bạn phê duyệt. Makoto không lưu khóa riêng tư.',
    '交易由你的钱包授权。Makoto 不存储私钥。',
    '取引はウォレットで承認されます。Makoto は秘密鍵を保存しません。',
    '거래는 지갑에서 승인됩니다. Makoto는 개인 키를 저장하지 않습니다.',
  ],
  'Confirm large transfers': ['Xác nhận giao dịch lớn', '确认大额转账', '高額送金を確認', '대량 전송 확인'],
  'Ask again before sending ≥ $100': ['Hỏi lại trước khi gửi ≥ $100', '发送 ≥ $100 前再次确认', '$100 以上の送金前に再確認', '$100 이상 전송 전 재확인'],
  'Transaction alerts': ['Thông báo giao dịch', '交易提醒', '取引通知', '거래 알림'],
  'Show incoming transfers in the in-app notification list': ['Hiện giao dịch nhận vào trong danh sách thông báo', '在应用通知中显示转入交易', 'アプリ内通知に入金を表示', '앱 알림 목록에 입금 표시'],
  'App Lock · coming soon': ['Khóa ứng dụng · sắp ra mắt', '应用锁 · 即将推出', 'アプリロック · 近日公開', '앱 잠금 · 곧 출시'],
  Version: ['Phiên bản', '版本', 'バージョン', '버전'],
  'Arc documentation': ['Tài liệu Arc', 'Arc 文档', 'Arc ドキュメント', 'Arc 문서'],
  'Tell us what to improve': ['Cho chúng tôi biết cần cải thiện gì', '告诉我们需要改进什么', '改善点を教えてください', '개선할 점을 알려주세요'],
  'Experimental · read-only market and chain data': ['Thử nghiệm · dữ liệu thị trường và chuỗi chỉ đọc', '实验性 · 只读市场与链上数据', '実験的 · 読み取り専用の市場・チェーンデータ', '실험적 · 읽기 전용 시장 및 체인 데이터'],
  Write: ['Viết', '撰写', '書く', '작성'],
  Open: ['Mở', '打开', '開く', '열기'],
  Preview: ['Xem trước', '预览', 'プレビュー', '미리보기'],
  'Add to wallet': ['Thêm vào ví', '添加到钱包', 'ウォレットに追加', '지갑에 추가'],
  'RPC status': ['Trạng thái RPC', 'RPC 状态', 'RPC ステータス', 'RPC 상태'],
  'Coming soon': ['Sắp ra mắt', '即将推出', '近日公開', '곧 출시'],
  'You can preview the privacy screen design — it is not a security feature.': ['Bạn có thể xem trước màn che riêng tư — đây không phải tính năng bảo mật.', '可预览隐私屏设计 — 这不是安全功能。', 'プライバシー画面のデザインをプレビューできます — セキュリティ機能ではありません。', '개인정보 화면 디자인을 미리 볼 수 있습니다 — 보안 기능이 아닙니다.'],
  "Faucet": ["Nhận token", "水龙头", "フォーセット", "파우셋"],
  "Testnet faucet": ["Nhận token testnet", "测试网水龙头", "テストネット・フォーセット", "테스트넷 파우셋"],
  "Get free test USDC and EURC on Arc Testnet from Circle's official faucet. Test tokens have no real value.": ["Nhận USDC và EURC thử nghiệm miễn phí trên Arc Testnet từ faucet chính thức của Circle. Token thử nghiệm không có giá trị thật.", "从 Circle 官方水龙头免费领取 Arc 测试网 USDC 和 EURC。测试代币没有实际价值。", "Circle 公式フォーセットから Arc テストネットの USDC・EURC を無料で入手。テストトークンに実際の価値はありません。", "Circle 공식 파우셋에서 Arc 테스트넷 USDC와 EURC를 무료로 받으세요. 테스트 토큰은 실제 가치가 없습니다."],
  "Request test tokens": ["Nhận token thử nghiệm", "领取测试代币", "テストトークンを受け取る", "테스트 토큰 받기"],
  "Provided by Circle · faucet.circle.com": ["Do Circle cung cấp · faucet.circle.com", "由 Circle 提供 · faucet.circle.com", "Circle 提供 · faucet.circle.com", "Circle 제공 · faucet.circle.com"],
  "Receiving address": ["Địa chỉ nhận", "接收地址", "受取アドレス", "받는 주소"],
  "Wallet connected": ["Đã kết nối ví", "钱包已连接", "ウォレット接続済み", "지갑 연결됨"],
  "Watch-only": ["Chỉ xem", "仅观察", "閲覧のみ", "보기 전용"],
  "Copy address": ["Sao chép địa chỉ", "复制地址", "アドレスをコピー", "주소 복사"],
  "Address copied": ["Đã sao chép địa chỉ", "地址已复制", "アドレスをコピーしました", "주소가 복사됨"],
  "Address copied — paste it in the Circle faucet": ["Đã sao chép địa chỉ — dán vào trang cấp token của Circle", "地址已复制 — 粘贴到 Circle 水龙头", "アドレスをコピーしました — Circle フォーセットに貼り付けてください", "주소 복사됨 — Circle 파우셋에 붙여넣으세요"],
  "Connect a wallet or watch your address so you can copy it and see test tokens arrive.": ["Kết nối ví hoặc theo dõi địa chỉ của bạn để sao chép và xem token thử nghiệm về ví.", "连接钱包或关注你的地址，以便复制并查看测试代币到账。", "ウォレットを接続するかアドレスを表示すると、コピーや着金確認ができます。", "지갑을 연결하거나 주소를 조회하면 복사하고 테스트 토큰 도착을 확인할 수 있습니다."],
  "Watch address": ["Theo dõi địa chỉ", "关注地址", "アドレスを表示", "주소 조회"],
  "Balance": ["Số dư", "余额", "残高", "잔액"],
  "Native gas token on Arc": ["Token gas gốc trên Arc", "Arc 原生 Gas 代币", "Arc のネイティブガストークン", "Arc 기본 가스 토큰"],
  "Euro stablecoin": ["Stablecoin Euro", "欧元稳定币", "ユーロ・ステーブルコイン", "유로 스테이블코인"],
  "Open Circle faucet": ["Mở faucet của Circle", "打开 Circle 水龙头", "Circle フォーセットを開く", "Circle 파우셋 열기"],
  "Refresh balance": ["Làm mới số dư", "刷新余额", "残高を更新", "잔액 새로고침"],
  "Refreshing balances…": ["Đang làm mới số dư…", "正在刷新余额…", "残高を更新中…", "잔액 새로고침 중…"],
  "Opens in a new tab. The faucet has a request limit per address — if it fails, try again later.": ["Mở trong tab mới. Faucet giới hạn số lần nhận cho mỗi địa chỉ — nếu không được, hãy thử lại sau.", "在新标签页打开。每个地址有领取次数限制 — 失败请稍后再试。", "新しいタブで開きます。アドレスごとに受取制限があります — 失敗した場合は後で再試行してください。", "새 탭에서 열립니다. 주소당 요청 한도가 있으니 실패하면 나중에 다시 시도하세요."],
  "How it works": ["Cách hoạt động", "使用方法", "使い方", "사용 방법"],
  "Copy your wallet address below.": ["Sao chép địa chỉ ví của bạn bên dưới.", "复制下方的钱包地址。", "下のウォレットアドレスをコピーします。", "아래 지갑 주소를 복사하세요."],
  "Open the official Circle faucet, choose “Arc Testnet” and the token (USDC or EURC).": ["Mở faucet chính thức của Circle, chọn “Arc Testnet” và loại token (USDC hoặc EURC).", "打开 Circle 官方水龙头，选择“Arc Testnet”和代币（USDC 或 EURC）。", "Circle 公式フォーセットを開き、「Arc Testnet」とトークン（USDC または EURC）を選択します。", "Circle 공식 파우셋을 열고 “Arc Testnet”과 토큰(USDC 또는 EURC)을 선택하세요."],
  "Paste your address, complete the check and request tokens.": ["Dán địa chỉ, hoàn tất bước xác minh và bấm nhận token.", "粘贴地址，完成验证并领取代币。", "アドレスを貼り付け、確認を完了してリクエストします。", "주소를 붙여넣고 확인을 완료한 뒤 토큰을 요청하세요."],
  "Come back here and refresh — test tokens usually arrive within a minute.": ["Quay lại đây và làm mới — token thường về trong khoảng một phút.", "回到这里刷新 — 测试代币通常一分钟内到账。", "ここに戻って更新 — 通常 1 分以内に届きます。", "여기로 돌아와 새로고침하세요 — 보통 1분 안에 도착합니다."],
  "On Arc, USDC is the gas token — you need a little test USDC to pay network fees.": ["Trên Arc, USDC là token trả phí gas — bạn cần một ít USDC thử nghiệm để trả phí mạng.", "在 Arc 上 USDC 是 Gas 代币 — 你需要少量测试 USDC 支付网络费。", "Arc では USDC がガストークンです — ネットワーク手数料に少量のテスト USDC が必要です。", "Arc에서는 USDC가 가스 토큰입니다 — 네트워크 수수료를 위해 약간의 테스트 USDC가 필요합니다."],
  "Makoto never asks for your private key to use the faucet.": ["Makoto không bao giờ yêu cầu khóa riêng tư để dùng trang cấp token.", "使用水龙头时 Makoto 绝不会索取你的私钥。", "フォーセット利用時に Makoto が秘密鍵を求めることはありません。", "Makoto는 파우셋 사용을 위해 개인 키를 요구하지 않습니다."],
  'Light mode': ['Chế độ sáng', '浅色模式', 'ライトモード', '라이트 모드'],
  'Dark mode': ['Chế độ tối', '深色模式', 'ダークモード', '다크 모드'],
  Appearance: ['Chế độ sáng / tối', '外观', '外観', '화면 모드'],
  Light: ['Sáng', '浅色', 'ライト', '라이트'],
  Dark: ['Tối', '深色', 'ダーク', '다크'],
  Explorer: ['Trình khám phá', '浏览器', 'エクスプローラー', '탐색기'],
}

const IDX: Record<Exclude<Lang, 'en'>, number> = { vi: 0, zh: 1, ja: 2, ko: 3 }
const KEY = 'mk.lang'
const listeners = new Set<() => void>()
let current: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY) as Lang | null
    if (v && LANGS.some((l) => l.code === v)) return v
    // First visit: follow the browser language when we support it
    const nav = (navigator.languages?.[0] ?? navigator.language ?? 'en').slice(0, 2).toLowerCase()
    return (LANGS.some((l) => l.code === nav) ? nav : 'en') as Lang
  } catch { return 'en' }
})()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function setLang(l: Lang) {
  current = l
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l
  listeners.forEach((f) => f())
}

export function translate(s: string, lang: Lang = current): string {
  if (lang === 'en') return s
  return (DICT[s] ?? PAGES_I18N[s] ?? EXTRA[s])?.[IDX[lang]] || s
}

/** Returns [t, lang]. `t` translates English source strings; unknown strings stay in English. */
export function useT() {
  const lang = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => current, () => 'en' as Lang)
  const t = <V,>(s: V): V => (typeof s === 'string' ? (translate(s, lang) as V) : s)
  return [t, lang] as const
}
