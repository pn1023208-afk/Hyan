import { config } from '../config.js'
import { get, paginate } from '../graph.js'
import { table, truncate } from '../output.js'
import type { Row } from '../output.js'
import type { Args } from '../util.js'
import { dateRange } from '../util.js'

interface PageSummary {
  id: string
  name: string
  category?: string
  tasks?: string[]
}

interface InsightValue {
  value: unknown
  end_time?: string
}

interface Insight {
  name: string
  period: string
  values: InsightValue[]
}

export async function list(): Promise<void> {
  const pages = await paginate<PageSummary>('me/accounts', { fields: 'id,name,category,tasks' })
  table(
    pages.map((page) => ({
      id: page.id,
      name: page.name,
      category: page.category ?? '',
      tasks: (page.tasks ?? []).join(' '),
    })),
  )
}

export async function info(): Promise<void> {
  const page = await get<Record<string, unknown>>(config.pageId, {
    fields: 'id,name,category,about,link,fan_count,followers_count,verification_status',
  })
  table([
    {
      id: page['id'],
      name: page['name'],
      followers: page['followers_count'],
      likes: page['fan_count'],
      category: page['category'],
      link: page['link'],
    },
  ])
}

/** Dùng chung cho lệnh pages:insights và cho báo cáo tổng hợp. */
export async function fetchInsights(args: Args): Promise<Row[]> {
  const { since, until } = dateRange(args)
  const metrics =
    args.flags['metrics'] ??
    'page_impressions,page_impressions_unique,page_post_engagements,page_fans'

  const response = await get<{ data: Insight[] }>(`${config.pageId}/insights`, {
    metric: metrics,
    period: args.flags['period'] ?? 'day',
    since,
    until,
  })

  return response.data.flatMap((insight) =>
    insight.values.map((point) => ({
      metric: insight.name,
      date: point.end_time?.slice(0, 10) ?? '',
      value: typeof point.value === 'object' ? truncate(JSON.stringify(point.value)) : point.value,
    })),
  )
}

export async function insights(args: Args): Promise<void> {
  table(await fetchInsights(args))
}
