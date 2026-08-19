import { join } from 'node:path'
import { writeCsv } from '../output.js'
import type { Args } from '../util.js'
import { dateRange } from '../util.js'
import { fetchInsights as fetchAdInsights } from './ads.js'
import { fetchInsights as fetchPageInsights } from './pages.js'
import { fetchPosts } from './posts.js'

/**
 * Page insights, bài viết và quảng cáo có độ hạt khác nhau (ngày / bài / campaign)
 * nên xuất thành ba file thay vì ép vào một bảng.
 */
export async function build(args: Args): Promise<void> {
  const { since, until } = dateRange(args)
  const outDir = args.flags['out'] ?? join('reports', `${since}_${until}`)
  const scoped: Args = { ...args, flags: { ...args.flags, since, until } }

  console.log(`Đang lấy dữ liệu từ ${since} đến ${until}...`)

  const [pageRows, postRows, adRows] = await Promise.all([
    fetchPageInsights(scoped),
    fetchPosts({ ...scoped, flags: { ...scoped.flags, limit: scoped.flags['limit'] ?? '200' } }),
    fetchAdInsights(scoped),
  ])

  await writeCsv(join(outDir, 'page-insights.csv'), pageRows)
  await writeCsv(join(outDir, 'posts.csv'), postRows)
  await writeCsv(join(outDir, 'ads.csv'), adRows)
}
