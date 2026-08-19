/**
 * Kéo lịch sử chi tiêu theo tháng của mọi tài khoản từng tiêu tiền.
 *
 * Chỉ quét tài khoản có amount_spent > 0 — số còn lại trọn đời bằng 0 nên không thể
 * có chi tiêu ở bất kỳ tháng nào, quét chúng chỉ tốn hạn mức API.
 *
 * Lấy trọn lịch sử (date_preset=maximum) thay vì một tháng cụ thể: cùng số lời gọi
 * nhưng trả lời được mọi tháng, và dùng lại được cho biểu đồ.
 *
 * Chạy: npm run spend
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
  INSERT INTO monthly_spend (account_id, month, currency, spend, impressions, clicks, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, month) DO UPDATE SET
    currency = excluded.currency, spend = excluded.spend,
    impressions = excluded.impressions, clicks = excluded.clicks,
    synced_at = excluded.synced_at
`)

const CHUNK = 50

async function main(): Promise<void> {
  const startedAt = Date.now()
  const ids = (
    db.prepare(`SELECT id FROM ad_accounts WHERE amount_spent > 0 ORDER BY amount_spent DESC`).all() as Array<{
      id: string
    }>
  ).map((row) => row.id)

  console.log(`Quét ${ids.length} tài khoản, gộp ${CHUNK} mỗi lời gọi → ${Math.ceil(ids.length / CHUNK)} lượt.`)

  const now = new Date().toISOString()
  let rowsWritten = 0
  let failed = 0

  for (let start = 0; start < ids.length; start += CHUNK) {
    const slice = ids.slice(start, start + CHUNK)
    const paths = slice.map(
      (id) =>
        `${id}/insights?level=account&time_increment=monthly&date_preset=maximum` +
        `&fields=spend,impressions,clicks,account_currency&limit=200`,
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
            row.date_start.slice(0, 7),
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
    console.log(`  ${done}/${ids.length} tài khoản · ${rowsWritten} dòng tháng · ${failed} lỗi`)
  }

  console.log(`\nXong sau ${Math.round((Date.now() - startedAt) / 1000)}s.`)

  console.log('\nTổng chi tiêu theo tháng (12 tháng gần nhất):')
  console.table(
    db
      .prepare(
        `SELECT month, currency, COUNT(*) AS so_tk, ROUND(SUM(spend)) AS chi_tieu
           FROM monthly_spend GROUP BY month, currency
          ORDER BY month DESC, chi_tieu DESC LIMIT 24`,
      )
      .all(),
  )
}

await main()
