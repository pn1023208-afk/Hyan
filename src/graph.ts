import { config } from './config.js'

const BASE = 'https://graph.facebook.com'

/** Mã lỗi Meta nên thử lại: rate limit và lỗi tạm thời. */
const RETRYABLE = new Set([1, 2, 4, 17, 32, 613, 80000, 80003, 80004, 80005, 80006, 80008])
const MAX_RETRIES = 4

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly subcode?: number,
    readonly type?: string,
  ) {
    super(message)
    this.name = 'GraphError'
  }
}

export type Params = Record<string, string | number | boolean | Blob | undefined>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function buildUrl(path: string, params: Params = {}): URL {
  const url = new URL(`${BASE}/${config.apiVersion}/${path.replace(/^\//, '')}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  url.searchParams.set('access_token', config.token)
  return url
}

/**
 * Meta trả về mức tiêu thụ hạn mức qua header. Đọc và tự nghỉ trước khi bị chặn,
 * vì bị chặn rồi thì phải chờ hàng chục phút.
 */
async function respectRateLimit(headers: Headers): Promise<void> {
  const buc = headers.get('x-business-use-case-usage')
  const app = headers.get('x-app-usage')
  let entries: Array<Record<string, unknown>> = []
  try {
    if (buc) {
      entries = Object.values(JSON.parse(buc) as Record<string, unknown[]>).flat() as Array<
        Record<string, unknown>
      >
    } else if (app) {
      entries = [JSON.parse(app) as Record<string, unknown>]
    }
  } catch {
    return // header sai định dạng thì bỏ qua, không đáng để làm hỏng request
  }

  for (const entry of entries) {
    const regainMinutes = Number(entry['estimated_time_to_regain_access'] ?? 0)
    if (regainMinutes > 0) {
      console.warn(`[rate-limit] Meta chặn tạm thời, chờ ${regainMinutes} phút...`)
      await sleep(regainMinutes * 60_000)
      return
    }
    const used = Math.max(
      Number(entry['call_count'] ?? 0),
      Number(entry['total_cputime'] ?? 0),
      Number(entry['total_time'] ?? 0),
    )
    if (used >= 90) {
      console.warn(`[rate-limit] Đã dùng ${used}% hạn mức, nghỉ 60s cho an toàn...`)
      await sleep(60_000)
      return
    }
  }
}

async function execute<T>(url: string | URL, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init)
    const payload = (await response.json()) as Record<string, unknown>
    await respectRateLimit(response.headers)

    if (response.ok) return payload as T

    const error = (payload['error'] ?? {}) as Record<string, unknown>
    const code = Number(error['code'] ?? response.status)
    if (RETRYABLE.has(code) && attempt < MAX_RETRIES) {
      const wait = 2 ** (attempt + 1) * 1000
      console.warn(`[retry] code=${code}, thử lại sau ${wait / 1000}s (${attempt + 1}/${MAX_RETRIES})`)
      await sleep(wait)
      continue
    }
    throw new GraphError(
      String(error['message'] ?? `HTTP ${response.status}`),
      code,
      error['error_subcode'] as number | undefined,
      error['type'] as string | undefined,
    )
  }
}

export function get<T>(path: string, params: Params = {}): Promise<T> {
  return execute<T>(buildUrl(path, params))
}

/** Mọi POST đều gửi multipart để dùng chung một đường code cho cả upload file. */
export function post<T>(path: string, fields: Params = {}): Promise<T> {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (value instanceof Blob) form.set(key, value)
    else form.set(key, String(value))
  }
  return execute<T>(buildUrl(path), { method: 'POST', body: form })
}

export function del<T>(path: string, params: Params = {}): Promise<T> {
  return execute<T>(buildUrl(path, params), { method: 'DELETE' })
}

const BATCH_SIZE = 50

interface BatchEntry {
  code: number
  body: string
}

/**
 * Gộp nhiều lời gọi GET vào một request. Meta cho tối đa 50 mỗi lần.
 *
 * Cần cho việc đồng bộ camp: lấy riêng từng tài khoản là hơn 12.000 lời gọi và
 * chắc chắn bị chặn, gộp lại còn khoảng 250.
 *
 * Lời gọi con thất bại trả về `null` ở đúng vị trí của nó thay vì ném lỗi — một
 * tài khoản hỏng không đáng để làm chết cả vòng đồng bộ.
 */
export async function batchGet<T>(paths: string[]): Promise<Array<T | null>> {
  const results: Array<T | null> = []

  for (let index = 0; index < paths.length; index += BATCH_SIZE) {
    const chunk = paths.slice(index, index + BATCH_SIZE)
    const entries = await post<BatchEntry[]>('', {
      batch: JSON.stringify(chunk.map((relative_url) => ({ method: 'GET', relative_url }))),
      include_headers: false,
    })

    for (const entry of entries) {
      if (entry?.code !== 200) {
        results.push(null)
        continue
      }
      try {
        results.push(JSON.parse(entry.body) as T)
      } catch {
        results.push(null)
      }
    }
  }
  return results
}

interface Page<T> {
  data: T[]
  paging?: { next?: string }
}

/** Tự đi hết các trang kết quả, dừng khi đủ `max` phần tử. */
export async function paginate<T>(path: string, params: Params = {}, max = Infinity): Promise<T[]> {
  const collected: T[] = []
  let page = await get<Page<T>>(path, { limit: 100, ...params })

  while (true) {
    collected.push(...(page.data ?? []))
    if (collected.length >= max || !page.paging?.next) break
    page = await execute<Page<T>>(page.paging.next)
  }
  return Number.isFinite(max) ? collected.slice(0, max) : collected
}
