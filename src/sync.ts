/**
 * Kéo toàn bộ tài khoản quảng cáo về SQLite.
 *
 * Lấy tất cả các trường trong cùng một lần phân trang thay vì gọi riêng từng tài khoản —
 * với 12.554 tài khoản thì cách sau tốn 12.554 lời gọi và chắc chắn bị Meta chặn.
 *
 * Chạy: npm run sync
 */
import { db } from './db.js'
import { paginate } from './graph.js'

interface RawAccount {
  id: string
  name?: string
  currency?: string
  amount_spent?: string
  balance?: string
  spend_cap?: string
  account_status?: number
  disable_reason?: number
  is_prepay_account?: boolean
  funding_source_details?: { display_string?: string }
  business?: { id?: string; name?: string }
  timezone_name?: string
  created_time?: string
}

const FIELDS = [
  'id',
  'name',
  'currency',
  'amount_spent',
  'balance',
  'spend_cap',
  'account_status',
  'disable_reason',
  'is_prepay_account',
  'funding_source_details',
  'business',
  'timezone_name',
  'created_time',
].join(',')

const upsert = db.prepare(`
  INSERT INTO ad_accounts (
    id, name, currency, amount_spent, balance, spend_cap, account_status,
    disable_reason, is_prepay_account, card, business_id, business_name,
    timezone_name, created_time, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name              = excluded.name,
    currency          = excluded.currency,
    amount_spent      = excluded.amount_spent,
    balance           = excluded.balance,
    spend_cap         = excluded.spend_cap,
    account_status    = excluded.account_status,
    disable_reason    = excluded.disable_reason,
    is_prepay_account = excluded.is_prepay_account,
    card              = excluded.card,
    business_id       = excluded.business_id,
    business_name     = excluded.business_name,
    timezone_name     = excluded.timezone_name,
    created_time      = excluded.created_time,
    synced_at         = excluded.synced_at
`)

interface Business {
  id: string
  name?: string
}

/**
 * `me/adaccounts` chỉ trả về tài khoản mà người dùng có vai trò trực tiếp, nên nó
 * bỏ sót tài khoản chỉ thuộc Business Manager. Đo thực tế: 12.556 so với 32.135 khi
 * quét cả hai nguồn — phần thiếu chiếm 27% chi tiêu của một ngày.
 *
 * Một Business Manager đọc lỗi không đáng để làm chết cả vòng đồng bộ, nên bỏ qua và
 * đếm lại ở cuối.
 */
async function collectAccounts(): Promise<RawAccount[]> {
  const byId = new Map<string, RawAccount>()

  for (const account of await paginate<RawAccount>('me/adaccounts', { fields: FIELDS })) {
    byId.set(account.id, account)
  }
  console.log(`  me/adaccounts: ${byId.size} tài khoản`)

  const businesses = await paginate<Business>('me/businesses', { fields: 'id,name' })
  console.log(`  Business Manager: ${businesses.length}`)

  let failedEdges = 0
  for (const [index, business] of businesses.entries()) {
    for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
      try {
        for (const account of await paginate<RawAccount>(`${business.id}/${edge}`, { fields: FIELDS })) {
          if (!byId.has(account.id)) byId.set(account.id, account)
        }
      } catch {
        failedEdges += 1
      }
    }
    if ((index + 1) % 25 === 0) {
      console.log(`  ...${index + 1}/${businesses.length} BM · ${byId.size} tài khoản`)
    }
  }
  if (failedEdges > 0) console.log(`  ${failedEdges} edge không đọc được.`)

  return [...byId.values()]
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  console.log('Đang kéo danh sách tài khoản quảng cáo từ Facebook...')

  const accounts = await collectAccounts()
  console.log(`Nhận được ${accounts.length} tài khoản, đang ghi vào cơ sở dữ liệu...`)

  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const account of accounts) {
      upsert.run(
        account.id,
        account.name ?? '',
        account.currency ?? '',
        Number(account.amount_spent ?? 0),
        Number(account.balance ?? 0),
        Number(account.spend_cap ?? 0),
        account.account_status ?? 0,
        account.disable_reason ?? 0,
        account.is_prepay_account ? 1 : 0,
        account.funding_source_details?.display_string ?? '',
        account.business?.id ?? '',
        account.business?.name ?? '',
        account.timezone_name ?? '',
        account.created_time ?? '',
        now,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000)
  console.log(`Xong sau ${seconds}s. Chạy "npm run web" để xem.`)
}

await main()
