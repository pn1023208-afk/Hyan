/**
 * Đăng nhập, phiên làm việc và nhật ký thao tác.
 * Dùng node:crypto có sẵn — không thêm thư viện, không gửi mật khẩu đi đâu cả.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'

const SESSION_DAYS = 7

// Chặn dò mật khẩu: đếm số lần sai theo IP, giữ trong bộ nhớ nên khởi động lại là xoá.
const LOCK_AFTER = 8
const LOCK_MINUTES = 15
const attempts = new Map<string, { count: number; until: number }>()

export interface User {
  id: number
  email: string
  name: string | null
  customer_id: number | null
  role: 'admin' | 'staff' | 'client'
  status: 'pending' | 'active' | 'disabled'
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':')
  if (!saltHex || !keyHex) return false
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export function isLocked(ip: string): boolean {
  const entry = attempts.get(ip)
  return entry !== undefined && entry.count >= LOCK_AFTER && Date.now() < entry.until
}

export function recordFailure(ip: string): void {
  const entry = attempts.get(ip) ?? { count: 0, until: 0 }
  entry.count += 1
  entry.until = Date.now() + LOCK_MINUTES * 60_000
  attempts.set(ip, entry)
}

export const clearFailures = (ip: string): void => void attempts.delete(ip)

export function login(email: string, password: string): User | null {
  const row = db
    .prepare(`SELECT * FROM users WHERE email = ? AND status = 'active'`)
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined

  if (!row || !verifyPassword(password, row.password_hash)) return null
  const { password_hash: _ignored, ...user } = row
  return user
}

/** Trả về mã phiên dạng chữ để đặt vào cookie; cơ sở dữ liệu chỉ giữ băm của nó. */
export function createSession(userId: number, ip: string): string {
  const token = randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000)
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)`,
  ).run(hashToken(token), userId, now.toISOString(), expires.toISOString(), ip)
  return token
}

export function userFromSession(token: string | undefined): User | null {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.customer_id, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .get(hashToken(token), new Date().toISOString()) as User | undefined
  return row ?? null
}

export const destroySession = (token: string): void =>
  void db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token))

export function register(email: string, password: string, name: string): void {
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, status, created_at)
     VALUES (?, ?, ?, 'client', 'pending', ?)`,
  ).run(email.trim().toLowerCase(), name, hashPassword(password), new Date().toISOString())
}

export function audit(user: User | null, ip: string, action: string, detail = ''): void {
  db.prepare(`INSERT INTO audit_log (at, user_id, ip, action, detail) VALUES (?, ?, ?, ?, ?)`).run(
    new Date().toISOString(),
    user?.id ?? null,
    ip,
    action,
    detail,
  )
}

/**
 * Điều kiện SQL giới hạn tài khoản quảng cáo mà người dùng được thấy.
 *
 * Đây là chốt phân quyền duy nhất — mọi truy vấn đụng tới ad_accounts phải đi qua đây,
 * đừng viết truy vấn bỏ qua nó.
 */
export function accountScope(user: User): { clause: string; params: Array<string | number> } {
  if (user.role === 'admin' || user.role === 'staff') return { clause: '', params: [] }
  if (user.customer_id === null) return { clause: 'AND 1 = 0', params: [] } // chưa gán khách: không thấy gì
  return {
    clause: 'AND id IN (SELECT account_id FROM customer_accounts WHERE customer_id = ?)',
    params: [user.customer_id],
  }
}
