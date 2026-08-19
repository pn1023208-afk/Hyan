import { config } from '../config.js'
import { get } from '../graph.js'
import { table } from '../output.js'

interface DebugToken {
  data: {
    app_id?: string
    type?: string
    application?: string
    expires_at?: number
    is_valid?: boolean
    scopes?: string[]
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>
  }
}

/** Lệnh chạy đầu tiên sau khi điền .env: xác nhận token sống và đủ quyền. */
export async function check(): Promise<void> {
  const response = await get<DebugToken>('debug_token', { input_token: config.token })
  const info = response.data

  table([
    {
      valid: info.is_valid ? 'yes' : 'NO',
      type: info.type ?? '',
      app: info.application ?? info.app_id ?? '',
      expires: info.expires_at ? new Date(info.expires_at * 1000).toISOString() : 'không hết hạn',
    },
  ])

  const scopes = info.scopes ?? info.granular_scopes?.map((entry) => entry.scope) ?? []
  console.log(`\nQuyền đang có (${scopes.length}):`)
  console.log(scopes.length ? scopes.map((scope) => `  - ${scope}`).join('\n') : '  (không có)')
}

interface ExchangeResponse {
  access_token: string
  expires_in?: number
}

/**
 * Đổi token cá nhân ngắn hạn lấy token dài hạn (~60 ngày).
 *
 * Chỉ áp dụng cho token NGƯỜI DÙNG. System User token vốn đã vĩnh viễn, không cần đổi.
 * App dùng để đổi phải chính là app đã cấp token — Facebook từ chối nếu lệch app.
 */
export async function extend(): Promise<void> {
  const appId = process.env['FB_APP_ID']
  const appSecret = process.env['FB_APP_SECRET']
  if (!appId || !appSecret) {
    throw new Error(
      'Cần FB_APP_ID và FB_APP_SECRET trong .env. Lấy tại: developers.facebook.com → app → Cài đặt → Cơ bản.',
    )
  }

  const response = await get<ExchangeResponse>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: config.token,
  })

  const days = response.expires_in ? Math.round(response.expires_in / 86400) : undefined
  console.log(`Token mới${days ? ` (còn ~${days} ngày)` : ''}:\n`)
  console.log(response.access_token)
  console.log('\nDán giá trị trên vào FB_ACCESS_TOKEN trong .env, rồi chạy: npm run fb -- token:check')
}
