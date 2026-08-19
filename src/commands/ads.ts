import { config } from '../config.js'
import { paginate, post } from '../graph.js'
import { table } from '../output.js'
import type { Row } from '../output.js'
import type { Args } from '../util.js'
import { dateRange, requireFlag, requirePositional } from '../util.js'

interface AdAccount {
  id: string
  name: string
  account_status: number
  currency: string
  amount_spent: string
}

interface Campaign {
  id: string
  name: string
  status: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
}

interface AdSet {
  id: string
  name: string
  status: string
  daily_budget?: string
  optimization_goal?: string
  campaign_id?: string
}

interface Action {
  action_type: string
  value: string
}

interface InsightRow {
  campaign_name?: string
  adset_name?: string
  ad_name?: string
  impressions?: string
  reach?: string
  clicks?: string
  ctr?: string
  cpc?: string
  cpm?: string
  spend?: string
  actions?: Action[]
}

const LEVELS = new Set(['account', 'campaign', 'adset', 'ad'])

export async function accounts(): Promise<void> {
  const list = await paginate<AdAccount>('me/adaccounts', {
    fields: 'id,name,account_status,currency,amount_spent',
  })
  table(
    list.map((account) => ({
      id: account.id,
      name: account.name,
      status: account.account_status === 1 ? 'ACTIVE' : `code ${account.account_status}`,
      currency: account.currency,
      spent: account.amount_spent,
    })),
  )
}

export async function campaigns(args: Args): Promise<void> {
  const list = await paginate<Campaign>(`${config.adAccountId}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget',
    effective_status: args.flags['status'],
  })
  table(
    list.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective ?? '',
      daily_budget: campaign.daily_budget ?? '',
      lifetime_budget: campaign.lifetime_budget ?? '',
    })),
  )
}

export async function adsets(args: Args): Promise<void> {
  const campaignId = args.flags['campaign']
  const path = campaignId ? `${campaignId}/adsets` : `${config.adAccountId}/adsets`
  const list = await paginate<AdSet>(path, {
    fields: 'id,name,status,daily_budget,optimization_goal,campaign_id',
  })
  table(
    list.map((adset) => ({
      id: adset.id,
      name: adset.name,
      status: adset.status,
      goal: adset.optimization_goal ?? '',
      daily_budget: adset.daily_budget ?? '',
      campaign_id: adset.campaign_id ?? '',
    })),
  )
}

/** Gom `actions` (mảng lồng) thành vài cột phẳng để đọc trên bảng và xuất CSV. */
function conversionCounts(actions: Action[] = []): Record<string, number> {
  const wanted: Record<string, string> = {
    purchase: 'purchases',
    lead: 'leads',
    link_click: 'link_clicks',
    post_engagement: 'engagements',
  }
  const counts: Record<string, number> = {}
  for (const action of actions) {
    const column = wanted[action.action_type]
    if (column) counts[column] = Number(action.value)
  }
  return counts
}

/** Dùng chung cho lệnh ads:insights và cho báo cáo tổng hợp. */
export async function fetchInsights(args: Args): Promise<Row[]> {
  const level = args.flags['level'] ?? 'campaign'
  if (!LEVELS.has(level)) {
    throw new Error(`--level phải là một trong: ${[...LEVELS].join(', ')}`)
  }
  const { since, until } = dateRange(args)

  const rows = await paginate<InsightRow>(`${config.adAccountId}/insights`, {
    level,
    fields: 'campaign_name,adset_name,ad_name,impressions,reach,clicks,ctr,cpc,cpm,spend,actions',
    time_range: JSON.stringify({ since, until }),
  })

  return rows.map((row) => ({
    name: row.ad_name ?? row.adset_name ?? row.campaign_name ?? '(tổng)',
    impressions: row.impressions ?? '0',
    reach: row.reach ?? '0',
    clicks: row.clicks ?? '0',
    ctr: row.ctr ?? '0',
    cpc: row.cpc ?? '0',
    cpm: row.cpm ?? '0',
    spend: row.spend ?? '0',
    ...conversionCounts(row.actions),
  }))
}

export async function insights(args: Args): Promise<void> {
  table(await fetchInsights(args))
}

export async function toggle(args: Args): Promise<void> {
  const objectId = requirePositional(args, 0, 'campaign|adset|ad-id')
  const status = requireFlag(args, 'status').toUpperCase()
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    throw new Error('--status chỉ nhận ACTIVE hoặc PAUSED')
  }
  await post(objectId, { status })
  console.log(`Đã đặt ${objectId} sang ${status}`)
}
