/**
 * Quản trị từ dòng lệnh: tạo người dùng, tạo khách, gán tài khoản quảng cáo cho khách.
 * Những việc này cố ý không đưa lên web — chúng chỉ làm một lần lúc khởi tạo,
 * và giữ ngoài web thì bớt được một mặt tấn công.
 *
 * npm run manage -- user:add admin@congty.vn "mat khau dai" "Phú Trần" admin
 * npm run manage -- customer:add "Công ty ABC" 50000000
 * npm run manage -- customer:assign 1 act_123 act_456
 * npm run manage -- user:list
 */
import { db } from './db.js'
import { hashPassword } from './auth.js'

const ROLES = new Set(['admin', 'staff', 'client'])

function userAdd(args: string[]): void {
  const [email, password, name, role = 'client'] = args
  if (!email || !password || !name) throw new Error('Dùng: user:add <email> <mật khẩu> <tên> [vai trò]')
  if (!ROLES.has(role)) throw new Error(`Vai trò phải là: ${[...ROLES].join(', ')}`)
  if (password.length < 10) throw new Error('Mật khẩu tối thiểu 10 ký tự')

  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, status, created_at, approved_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(email.trim().toLowerCase(), name, hashPassword(password), role, new Date().toISOString(), new Date().toISOString())

  console.log(`Đã tạo ${email} với vai trò ${role}, trạng thái active.`)
}

function userList(): void {
  console.table(
    db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.status, c.name AS khach
           FROM users u LEFT JOIN customers c ON c.id = u.customer_id
          ORDER BY u.id`,
      )
      .all(),
  )
}

function customerAdd(args: string[]): void {
  const [name, cap = '0'] = args
  if (!name) throw new Error('Dùng: customer:add <tên khách> [hạn mức ngày]')
  const result = db
    .prepare(`INSERT INTO customers (name, daily_budget_cap, created_at) VALUES (?, ?, ?)`)
    .run(name, Number(cap), new Date().toISOString())
  console.log(`Đã tạo khách "${name}" với id ${result.lastInsertRowid}.`)
}

function customerAssign(args: string[]): void {
  const [customerId, ...accountIds] = args
  if (!customerId || accountIds.length === 0) {
    throw new Error('Dùng: customer:assign <id khách> <act_...> [act_...]')
  }
  const insert = db.prepare(
    `INSERT OR IGNORE INTO customer_accounts (customer_id, account_id) VALUES (?, ?)`,
  )
  for (const accountId of accountIds) insert.run(Number(customerId), accountId)
  console.log(`Đã gán ${accountIds.length} tài khoản cho khách ${customerId}.`)
}

function customerList(): void {
  console.table(
    db
      .prepare(
        `SELECT c.id, c.name, c.daily_budget_cap,
                (SELECT COUNT(*) FROM customer_accounts a WHERE a.customer_id = c.id) AS so_tkqc
           FROM customers c ORDER BY c.id`,
      )
      .all(),
  )
}

const [command, ...rest] = process.argv.slice(2)

switch (command) {
  case 'user:add':
    userAdd(rest)
    break
  case 'user:list':
    userList()
    break
  case 'customer:add':
    customerAdd(rest)
    break
  case 'customer:assign':
    customerAssign(rest)
    break
  case 'customer:list':
    customerList()
    break
  default:
    console.log('Lệnh: user:add, user:list, customer:add, customer:assign, customer:list')
}
