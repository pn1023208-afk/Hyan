/**
 * Chốt sổ chi tiêu theo NGÀY.
 *
 * Lý do tồn tại: đội tài khoản thay mới khoảng 96% mỗi tháng, và tài khoản đã bị xoá
 * thì Graph API không trả về lịch sử chi tiêu của nó nữa. Đo lại tháng 7 sau khi tháng
 * kết thúc chỉ thu được 8,6% số USD thật. Muốn có số đúng thì phải lấy trong ngày.
 *
 * Lấy một cửa sổ vài ngày chứ không chỉ hôm nay, vì hai lý do: Meta còn chỉnh lại số
 * của một ngày trong nhiều giờ sau khi ngày đó kết thúc, và nếu lỡ một buổi chạy thì
 * lượt sau vẫn vá được. Ghi đè theo khoá (account_id, day) nên chạy lại luôn an toàn.
 *
 * Cần chạy `npm run sync` trước: danh sách quét lấy từ bảng ad_accounts, tài khoản mới
 * chưa đồng bộ thì chưa có trong đó.
 *
 * Chạy: npm run daily        (mặc định 3 ngày gần nhất)
 *       npm run daily -- 7   (7 ngày gần nhất)
 */
import { db } from './db.js'
import { batchGet } from './graph.js'

interface InsightRow {
  date_start?: string
  spend?: string
  impressions?: string
  clicks?: string
  account_currency?: string
}

const upsert = db.prepare(`
  INSERT INTO daily_spend (account_id, day, currency, spend, impressions, clicks, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, day) DO UPDATE SET
    currency = excluded.currency, spend = excluded.spend,
    impressions = excluded.impressions, clicks = excluded.clicks,
    synced_at = excluded.synced_at
`)

const CHUNK = 50

/**
 * Ngày theo giờ máy, không phải UTC. Máy ở UTC+7 lúc rạng sáng vẫn đang là ngày hôm
 * trước theo UTC, nên dùng toISOString() sẽ hụt mất ngày hiện tại của những tài khoản
 * đặt múi giờ châu Á — vốn là phần lớn tài khoản đang chạy.
 */
const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

async function main(): Promise<void> {
  const days = Math.max(1, Number(process.argv[2] ?? 3))
  const until = new Date()
  const since = new Date(until)
  since.setDate(since.getDate() - (days - 1))

  const range = JSON.stringify({ since: isoDay(since), until: isoDay(until) })

  // Tài khoản chưa từng tiêu đồng nào trọn đời thì không thể có chi tiêu trong cửa sổ
  // này — bỏ qua để khỏi đốt hạn mức API cho hàng chục nghìn tài khoản rỗng.
  const ids = (
    db.prepare(`SELECT id FROM ad_accounts WHERE amount_spent > 0 ORDER BY amount_spent DESC`).all() as Array<{
      id: string
    }>
  ).map((row) => row.id)

  const startedAt = Date.now()
  console.log(`Chốt sổ ${isoDay(since)} → ${isoDay(until)} trên ${ids.length} tài khoản.`)
  console.log(`Gộp ${CHUNK} mỗi lời gọi → ${Math.ceil(ids.length / CHUNK)} lượt.\n`)

  const now = new Date().toISOString()
  let rowsWritten = 0
  let failed = 0

  for (let start = 0; start < ids.length; start += CHUNK) {
    const slice = ids.slice(start, start + CHUNK)
    const paths = slice.map(
      (id) =>
        `${id}/insights?level=account&time_increment=1&time_range=${encodeURIComponent(range)}` +
        `&fields=spend,impressions,clicks,account_currency&limit=100`,
    )

    const responses = await batchGet<{ data?: InsightRow[] }>(paths)

    db.exec('BEGIN')
    try {
      responses.forEach((response, index) => {
        if (!response) {
          failed += 1
          return
        }
        for (const row of response.data ?? []) {
          if (!row.date_start) continue
          upsert.run(
            slice[index]!,
            row.date_start,
            row.account_currency ?? '',
            Number(row.spend ?? 0),
            Number(row.impressions ?? 0),
            Number(row.clicks ?? 0),
            now,
          )
          rowsWritten += 1
        }
      })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    const done = Math.min(start + CHUNK, ids.length)
    if (done % 2000 < CHUNK || done === ids.length) {
      console.log(`  ${done}/${ids.length} tài khoản · ${rowsWritten} dòng ngày · ${failed} lỗi`)
    }
  }

  console.log(`\nXong sau ${Math.round((Date.now() - startedAt) / 1000)}s.`)

  console.log('\nChi tiêu theo ngày vừa chốt:')
  console.table(
    db
      .prepare(
        `SELECT day, currency, COUNT(*) AS so_tk, ROUND(SUM(spend), 2) AS chi_tieu
           FROM daily_spend
          WHERE day >= ? AND spend > 0
          GROUP BY day, currency
          ORDER BY day DESC, chi_tieu DESC`,
      )
      .all(isoDay(since)),
  )
}

await main()
