/**
 * Máy chủ web. Chỉ đọc SQLite, không gọi Facebook — trang tải tức thì, không bao giờ
 * chạm giới hạn API, và tiến trình này không cần giữ token.
 *
 * Luôn nghe ở 127.0.0.1. Ra Internet thì đặt Caddy đứng trước để lo HTTPS;
 * không bao giờ mở thẳng cổng này ra ngoài.
 *
 * Chạy: npm run web
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { db, disableLabel, statusLabel } from './db.js'
import {
  accountScope,
  audit,
  clearFailures,
  createSession,
  destroySession,
  isLocked,
  login,
  recordFailure,
  register,
  userFromSession,
} from './auth.js'
import type { User } from './auth.js'

const PORT = Number(process.env['WEB_PORT'] ?? 3000)
const HOST = '127.0.0.1'

// Bật khi có Caddy/IIS đứng trước, để nhật ký ghi đúng IP người dùng thay vì 127.0.0.1.
const TRUST_PROXY = process.env['TRUST_PROXY'] === '1'
const SECURE_COOKIE = process.env['SECURE_COOKIE'] === '1'

type Req = IncomingMessage
type Res = ServerResponse

function clientIp(request: Req): string {
  if (TRUST_PROXY) {
    const forwarded = request.headers['x-forwarded-for']
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    if (first) return first
  }
  return request.socket.remoteAddress ?? ''
}

function cookies(request: Req): Record<string, string> {
  const jar: Record<string, string> = {}
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0) jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1))
  }
  return jar
}

async function formBody(request: Req): Promise<Record<string, string>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > 64_000) throw new Error('Dữ liệu gửi lên quá lớn')
    chunks.push(chunk as Buffer)
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
  return Object.fromEntries(params)
}

const json = (response: Res, data: unknown, code = 200): void => {
  response.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

const redirect = (response: Res, to: string): void => {
  response.writeHead(302, { location: to })
  response.end()
}

async function page(response: Res, file: string, code = 200): Promise<void> {
  const html = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8')
  response.writeHead(code, { 'content-type': 'text/html; charset=utf-8' })
  response.end(html)
}

// ------------------------------------------------------------------ Truy vấn

function summary(user: User): unknown {
  const scope = accountScope(user)

  const byCurrency = db
    .prepare(
      `SELECT currency, COUNT(*) AS accounts, SUM(amount_spent) AS spent, SUM(balance) AS balance
         FROM ad_accounts WHERE currency <> '' ${scope.clause}
        GROUP BY currency ORDER BY spent DESC`,
    )
    .all(...scope.params)

  const byStatus = db
    .prepare(
      `SELECT account_status, COUNT(*) AS accounts
         FROM ad_accounts WHERE 1 = 1 ${scope.clause}
        GROUP BY account_status ORDER BY accounts DESC`,
    )
    .all(...scope.params) as Array<{ account_status: number; accounts: number }>

  const meta = db
    .prepare(`SELECT COUNT(*) AS total, MAX(synced_at) AS synced_at FROM ad_accounts WHERE 1 = 1 ${scope.clause}`)
    .get(...scope.params)

  return {
    byCurrency,
    byStatus: byStatus.map((row) => ({ ...row, label: statusLabel(row.account_status) })),
    ...(meta as object),
    viewer: { name: user.name ?? user.email, role: user.role },
  }
}

function accounts(user: User, url: URL): unknown {
  const scope = accountScope(user)
  const where: string[] = []
  const params: Array<string | number> = [...scope.params]

  const query = (url.searchParams.get('q') ?? '').trim()
  if (query) {
    where.push('AND (id LIKE ? OR name LIKE ? OR business_name LIKE ? OR card LIKE ?)')
    params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`)
  }
  const status = url.searchParams.get('status')
  if (status) {
    where.push('AND account_status = ?')
    params.push(Number(status))
  }
  const currency = url.searchParams.get('currency')
  if (currency) {
    where.push('AND currency = ?')
    params.push(currency)
  }

  const clause = `WHERE 1 = 1 ${scope.clause} ${where.join(' ')}`
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 1000)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)

  const total = db.prepare(`SELECT COUNT(*) AS n FROM ad_accounts ${clause}`).get(...params) as { n: number }
  const rows = db
    .prepare(
      `SELECT id, name, currency, amount_spent, balance, account_status,
              is_prepay_account, card, business_name, synced_at
         FROM ad_accounts ${clause}
        ORDER BY balance DESC, amount_spent DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>

  return {
    total: total.n,
    rows: rows.map((row) => ({ ...row, status_label: statusLabel(Number(row['account_status'])) })),
  }
}

// ------------------------------------------------------------------- Bảng chi tiết

const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

/** Bảng đầy đủ giống panel Ads Check: mọi cột lấy được từ API, kèm chi tiêu tháng này. */
function panel(user: User, url: URL): unknown {
  const scope = accountScope(user)
  const where: string[] = []
  const params: Array<string | number> = [...scope.params]

  const query = (url.searchParams.get('q') ?? '').trim()
  if (query) {
    where.push('AND (a.id LIKE ? OR a.name LIKE ? OR a.business_name LIKE ? OR a.business_id LIKE ? OR a.card LIKE ?)')
    const like = `%${query}%`
    params.push(like, like, like, like, like)
  }
  const status = url.searchParams.get('status')
  if (status) {
    where.push('AND a.account_status = ?')
    params.push(Number(status))
  }
  const currency = url.searchParams.get('currency')
  if (currency) {
    where.push('AND a.currency = ?')
    params.push(currency)
  }
  const business = url.searchParams.get('business_id')
  if (business) {
    where.push('AND a.business_id = ?')
    params.push(business)
  }
  // Bộ lọc nhanh: chỉ tài khoản đang tiêu tiền tháng này, hoặc chỉ tài khoản bị khoá.
  if (url.searchParams.get('spending') === '1') where.push('AND m.spend > 0')
  if (url.searchParams.get('disabled') === '1') where.push('AND a.account_status <> 1')

  const scoped = `${scope.clause} ${where.join(' ')}`
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)

  const sorts: Record<string, string> = {
    month: 'month_spend DESC',
    balance: 'a.balance DESC',
    spent: 'a.amount_spent DESC',
    created: 'a.created_time DESC',
    name: 'a.name COLLATE NOCASE ASC',
  }
  const order = sorts[url.searchParams.get('sort') ?? 'month'] ?? sorts['month']

  const from = `
    FROM ad_accounts a
    LEFT JOIN monthly_spend m ON m.account_id = a.id AND m.month = ?
    LEFT JOIN account_notes n ON n.account_id = a.id
    WHERE 1 = 1 ${scoped}`

  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(CURRENT_MONTH, ...params) as { n: number }

  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.currency, a.amount_spent, a.balance, a.spend_cap,
              a.account_status, a.disable_reason, a.is_prepay_account, a.card,
              a.business_id, a.business_name, a.timezone_name, a.created_time,
              COALESCE(m.spend, 0) AS month_spend,
              n.note AS note
         ${from}
        ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(CURRENT_MONTH, ...params, limit, offset) as Array<Record<string, unknown>>

  return {
    total: total.n,
    month: CURRENT_MONTH,
    offset,
    limit,
    rows: rows.map((row) => ({
      ...row,
      status_label: statusLabel(Number(row['account_status'])),
      disable_label: disableLabel(Number(row['disable_reason'])),
    })),
  }
}

/** Đếm cho thanh tab: số tài khoản, số BM, đang chạy, bị khoá — trong phạm vi người xem. */
function panelTabs(user: User): unknown {
  const scope = accountScope(user)
  const one = (sql: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ad_accounts WHERE 1 = 1 ${scope.clause} ${sql}`).get(...scope.params) as {
      n: number
    }).n

  const businesses = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT business_id) AS n FROM ad_accounts
          WHERE business_id <> '' ${scope.clause}`,
      )
      .get(...scope.params) as { n: number }
  ).n

  const synced = db.prepare(`SELECT MAX(synced_at) AS t FROM ad_accounts`).get() as { t: string | null }

  return {
    accounts: one(''),
    businesses,
    active: one('AND account_status = 1'),
    disabled: one('AND account_status <> 1'),
    viewer: { name: user.name ?? user.email, role: user.role },
    synced_at: synced.t,
  }
}

/** Danh sách BM để đổ vào ô lọc, kèm số tài khoản mỗi BM. */
function businesses(user: User): unknown {
  const scope = accountScope(user)
  return db
    .prepare(
      `SELECT business_id, business_name, COUNT(*) AS accounts
         FROM ad_accounts WHERE business_id <> '' ${scope.clause}
        GROUP BY business_id ORDER BY accounts DESC LIMIT 500`,
    )
    .all(...scope.params)
}

const saveNote = db.prepare(`
  INSERT INTO account_notes (account_id, note, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(account_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
`)

// -------------------------------------------------------------------- Định tuyến

async function handle(request: Req, response: Res): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
  const ip = clientIp(request)
  const token = cookies(request)['sid']
  const user = userFromSession(token)
  const path = url.pathname

  // --- Không cần đăng nhập
  if (path === '/login' && request.method === 'GET') return page(response, 'login.html')
  if (path === '/register' && request.method === 'GET') return page(response, 'register.html')

  if (path === '/login' && request.method === 'POST') {
    if (isLocked(ip)) {
      audit(null, ip, 'login.locked')
      return page(response, 'login.html', 429)
    }
    const body = await formBody(request)
    const found = login(body['email'] ?? '', body['password'] ?? '')
    if (!found) {
      recordFailure(ip)
      audit(null, ip, 'login.failed', body['email'] ?? '')
      return redirect(response, '/login?loi=1')
    }
    clearFailures(ip)
    const sid = createSession(found.id, ip)
    audit(found, ip, 'login.ok')
    response.writeHead(302, {
      location: '/',
      'set-cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}${SECURE_COOKIE ? '; Secure' : ''}`,
    })
    response.end()
    return
  }

  if (path === '/register' && request.method === 'POST') {
    const body = await formBody(request)
    try {
      register(body['email'] ?? '', body['password'] ?? '', body['name'] ?? '')
      audit(null, ip, 'register', body['email'] ?? '')
    } catch {
      return redirect(response, '/register?loi=1') // email đã tồn tại
    }
    return redirect(response, '/login?dangky=1')
  }

  if (path === '/logout') {
    if (token) destroySession(token)
    audit(user, ip, 'logout')
    response.writeHead(302, { location: '/login', 'set-cookie': 'sid=; Path=/; Max-Age=0' })
    response.end()
    return
  }

  // --- Từ đây bắt buộc đăng nhập
  if (!user) {
    if (path.startsWith('/api/')) return json(response, { error: 'Chưa đăng nhập' }, 401)
    return redirect(response, '/login')
  }

  if (path === '/') return page(response, 'panel.html')
  if (path === '/summary') return page(response, 'index.html')
  if (path === '/api/summary') return json(response, summary(user))
  if (path === '/api/accounts') {
    audit(user, ip, 'accounts.list', url.search)
    return json(response, accounts(user, url))
  }

  // --- Bảng chi tiết kiểu Ads Check
  if (path === '/api/panel/tabs') return json(response, panelTabs(user))
  if (path === '/api/panel/businesses') return json(response, businesses(user))
  if (path === '/api/panel') {
    audit(user, ip, 'panel.list', url.search)
    return json(response, panel(user, url))
  }
  if (path === '/api/panel/note' && request.method === 'POST') {
    // Ghi chú tay chỉ dành cho nội bộ; nhân viên của khách không sửa được.
    if (user.role === 'client') return json(response, { error: 'Không có quyền' }, 403)
    const body = await formBody(request)
    const accountId = body['account_id'] ?? ''
    if (!accountId) return json(response, { error: 'Thiếu account_id' }, 400)
    saveNote.run(accountId, body['note'] ?? '', new Date().toISOString())
    audit(user, ip, 'panel.note', accountId)
    return json(response, { ok: true })
  }

  // --- Chỉ quản trị viên
  if (path.startsWith('/admin')) {
    if (user.role !== 'admin') {
      audit(user, ip, 'admin.denied', path)
      return json(response, { error: 'Không có quyền' }, 403)
    }
    if (path === '/admin' && request.method === 'GET') return page(response, 'admin.html')

    if (path === '/admin/pending') {
      return json(
        response,
        db
          .prepare(`SELECT id, email, name, created_at FROM users WHERE status = 'pending' ORDER BY created_at`)
          .all(),
      )
    }

    if (path === '/admin/approve' && request.method === 'POST') {
      const body = await formBody(request)
      const userId = Number(body['user_id'])
      const customerId = body['customer_id'] ? Number(body['customer_id']) : null
      db.prepare(`UPDATE users SET status = 'active', approved_at = ?, customer_id = ? WHERE id = ?`).run(
        new Date().toISOString(),
        customerId,
        userId,
      )
      audit(user, ip, 'user.approve', `user=${userId} customer=${customerId}`)
      return json(response, { ok: true })
    }

    if (path === '/admin/audit') {
      return json(
        response,
        db
          .prepare(
            `SELECT a.at, a.ip, a.action, a.detail, u.email
               FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
              ORDER BY a.id DESC LIMIT 300`,
          )
          .all(),
      )
    }

    if (path === '/admin/customers') {
      return json(response, db.prepare(`SELECT id, name, daily_budget_cap FROM customers ORDER BY name`).all())
    }
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Không tìm thấy')
}

createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    console.error(error)
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Lỗi máy chủ')
  })
}).listen(PORT, HOST, () => {
  console.log(`Dashboard đang chạy tại http://${HOST}:${PORT}`)
  if (!SECURE_COOKIE) console.log('Cảnh báo: chưa bật SECURE_COOKIE — chỉ dùng khi chạy cục bộ.')
})
