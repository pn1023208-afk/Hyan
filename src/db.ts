import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const FILE = process.env['DB_PATH'] ?? 'data/fb.db'

mkdirSync(dirname(FILE), { recursive: true })

export const db = new DatabaseSync(FILE)

// WAL để tiến trình đồng bộ ghi trong khi web đang đọc, không chặn nhau.
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS ad_accounts (
    id                TEXT PRIMARY KEY,
    name              TEXT,
    currency          TEXT,
    amount_spent      INTEGER,
    balance           INTEGER,
    spend_cap         INTEGER,
    account_status    INTEGER,
    disable_reason    INTEGER,
    is_prepay_account INTEGER,
    card              TEXT,
    business_id       TEXT,
    business_name     TEXT,
    timezone_name     TEXT,
    created_time      TEXT,
    synced_at         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_business ON ad_accounts(business_id);
  CREATE INDEX IF NOT EXISTS idx_accounts_status   ON ad_accounts(account_status);

  -- Ghi chú tay cho từng tài khoản: cột "Ghi chú" trên bảng. Tách bảng riêng để lần
  -- đồng bộ sau ghi đè ad_accounts không xoá mất chú thích người dùng nhập.
  CREATE TABLE IF NOT EXISTS account_notes (
    account_id TEXT PRIMARY KEY,
    note       TEXT,
    updated_at TEXT
  );

  -- Chi tiêu theo tháng, lấy từ insights.
  --
  -- CẢNH BÁO đơn vị: cột spend ở đây là đơn vị CHÍNH (đồng, đô-la) và có phần lẻ,
  -- khác hẳn ad_accounts.amount_spent vốn là đơn vị nhỏ nhất (cent với USD).
  -- Đừng cộng hai cột này với nhau.
  CREATE TABLE IF NOT EXISTS monthly_spend (
    account_id  TEXT NOT NULL,
    month       TEXT NOT NULL,        -- 'YYYY-MM'
    currency    TEXT,
    spend       REAL,
    impressions INTEGER,
    clicks      INTEGER,
    synced_at   TEXT NOT NULL,
    PRIMARY KEY (account_id, month)
  );

  CREATE INDEX IF NOT EXISTS idx_spend_month ON monthly_spend(month);

  -- Chi tiêu theo NGÀY.
  --
  -- Tồn tại vì tài khoản bị xoá thì lịch sử chi tiêu của nó mất theo: Graph API không
  -- trả về số liệu của tài khoản mà token không còn quyền truy cập, kể cả khi tiền đã
  -- tiêu thật. Đo lại tháng 7 sau khi tháng đã kết thúc chỉ thu được 8,6% số USD thật
  -- (224.727 trên 2.606.751) vì đội tài khoản thay mới 96% mỗi tháng.
  --
  -- Chốt sổ hằng ngày là cách duy nhất giữ được số liệu trước khi tài khoản biến mất.
  --
  -- Đơn vị giống monthly_spend: đơn vị CHÍNH của tiền tệ, có phần lẻ.
  CREATE TABLE IF NOT EXISTS daily_spend (
    account_id  TEXT NOT NULL,
    day         TEXT NOT NULL,        -- 'YYYY-MM-DD' theo múi giờ của chính tài khoản
    currency    TEXT,
    spend       REAL,
    impressions INTEGER,
    clicks      INTEGER,
    synced_at   TEXT NOT NULL,
    PRIMARY KEY (account_id, day)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_spend(day);

  -- Khách thuê tài khoản. Hạn mức là chốt chặn cuối: kể cả khi tài khoản đăng nhập
  -- của khách bị chiếm, thiệt hại vẫn bị giới hạn trong mức này.
  CREATE TABLE IF NOT EXISTS customers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    daily_budget_cap INTEGER NOT NULL DEFAULT 0,   -- 0 = không giới hạn
    created_at       TEXT NOT NULL
  );

  -- role: 'admin' (bạn), 'staff' (nhân viên bạn), 'client' (nhân viên của khách)
  -- status: 'pending' (chờ duyệt), 'active', 'disabled'
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT,
    password_hash TEXT NOT NULL,
    customer_id   INTEGER REFERENCES customers(id),
    role          TEXT NOT NULL DEFAULT 'client',
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL,
    approved_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS customer_accounts (
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    account_id  TEXT    NOT NULL,
    PRIMARY KEY (customer_id, account_id)
  );

  -- Chỉ lưu băm của mã phiên: lộ cơ sở dữ liệu cũng không cướp được phiên đang mở.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip         TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL,
    user_id INTEGER,
    ip      TEXT,
    action  TEXT NOT NULL,
    detail  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_at   ON audit_log(at);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
`)

// Cơ sở dữ liệu tạo trước khi có cột timezone_name thì CREATE TABLE IF NOT EXISTS ở trên
// không thêm cột. Vá bằng ALTER, bỏ qua nếu cột đã có.
function addColumnIfMissing(table: string, column: string, type: string): void {
  const exists = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column,
  )
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

addColumnIfMissing('ad_accounts', 'timezone_name', 'TEXT')

/** Trạng thái tài khoản do Meta quy định; 1 là bình thường, còn lại là các kiểu bị chặn. */
export const ACCOUNT_STATUS: Record<number, string> = {
  1: 'Đang hoạt động',
  2: 'Bị vô hiệu hoá',
  3: 'Chưa thanh toán',
  7: 'Đang chờ xét duyệt',
  8: 'Chờ ký hợp đồng',
  9: 'Đang trong thời gian ân hạn',
  100: 'Đã đóng',
  101: 'Bị khoá vĩnh viễn',
}

export const statusLabel = (code: number): string => ACCOUNT_STATUS[code] ?? `Mã ${code}`

/** Lý do Meta vô hiệu hoá tài khoản. 0 nghĩa là không bị khoá. */
export const DISABLE_REASON: Record<number, string> = {
  0: '',
  1: 'Vi phạm chính sách',
  2: 'Nghi ngờ gian lận thanh toán',
  3: 'Bị đội ngũ Meta xử lý',
  4: 'Bị xử lý do rủi ro',
  5: 'Chưa xác minh danh tính',
  6: 'Rủi ro cấp tài khoản',
  7: 'Rủi ro liên quan chính trị',
  8: 'Không đủ điều kiện',
  9: 'Chưa cấp quyền quảng cáo',
}

export const disableLabel = (code: number): string => DISABLE_REASON[code] ?? `Mã ${code}`
