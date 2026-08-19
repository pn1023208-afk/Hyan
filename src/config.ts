import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}. Sao chép .env.example thành .env rồi điền giá trị.`)
  }
  return value
}

/** Đọc lười (getter) để lệnh --help vẫn chạy được khi chưa có .env. */
export const config = {
  get token(): string {
    return required('FB_ACCESS_TOKEN')
  },
  get apiVersion(): string {
    return process.env.FB_API_VERSION ?? 'v23.0'
  },
  get pageId(): string {
    return required('FB_PAGE_ID')
  },
  get adAccountId(): string {
    const id = required('FB_AD_ACCOUNT_ID')
    return id.startsWith('act_') ? id : `act_${id}`
  },
}
