import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { config } from '../config.js'
import { post } from '../graph.js'
import type { Params } from '../graph.js'
import type { Args } from '../util.js'
import { requireFlag } from '../util.js'

/**
 * Mỗi mục tiêu ứng với đúng một bộ objective + optimization_goal + destination_type
 * mà Meta chấp nhận; lệch một mắt xích là API trả code 100 với thông báo rất mơ hồ.
 * Gom thành bảng để chỗ khác chỉ việc tra, không phải rẽ nhánh theo mục tiêu.
 */
interface Preset {
  objective: string
  optimizationGoal: string
  destinationType?: string
  /** Thứ được quảng bá: Page (tin nhắn, lead form) hoặc Pixel (chuyển đổi web). */
  promoted?: 'page' | 'pixel'
  needsLeadForm?: boolean
  callToAction: string
}

export type Goal = 'messages' | 'sales' | 'leads' | 'traffic' | 'engagement'

export const GOALS: Record<Goal, Preset> = {
  messages: {
    objective: 'OUTCOME_ENGAGEMENT',
    optimizationGoal: 'CONVERSATIONS',
    destinationType: 'MESSENGER',
    promoted: 'page',
    callToAction: 'MESSAGE_PAGE',
  },
  sales: {
    objective: 'OUTCOME_SALES',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    destinationType: 'WEBSITE',
    promoted: 'pixel',
    callToAction: 'SHOP_NOW',
  },
  leads: {
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'LEAD_GENERATION',
    destinationType: 'ON_AD',
    promoted: 'page',
    needsLeadForm: true,
    callToAction: 'SIGN_UP',
  },
  traffic: {
    objective: 'OUTCOME_TRAFFIC',
    optimizationGoal: 'LINK_CLICKS',
    destinationType: 'WEBSITE',
    callToAction: 'LEARN_MORE',
  },
  engagement: {
    objective: 'OUTCOME_ENGAGEMENT',
    optimizationGoal: 'POST_ENGAGEMENT',
    callToAction: 'LEARN_MORE',
  },
}

function preset(goal: string): Preset {
  const found = GOALS[goal as Goal]
  if (!found) throw new Error(`--goal phải là một trong: ${Object.keys(GOALS).join(', ')}`)
  return found
}

const status = (activate?: boolean) => (activate ? 'ACTIVE' : 'PAUSED')

// ------------------------------------------------------------------- Campaign

export interface CampaignInput {
  name: string
  goal: string
  /** Đặt ngân sách ở đây là bật CBO — khi đó ad set không được có ngân sách riêng. */
  dailyBudget?: number
  lifetimeBudget?: number
  activate?: boolean
}

export async function createCampaign(input: CampaignInput): Promise<{ id: string }> {
  const fields: Params = {
    name: input.name,
    objective: preset(input.goal).objective,
    status: status(input.activate),
    // Meta bắt buộc khai trường này, kể cả khi không thuộc nhóm bị hạn chế.
    special_ad_categories: '[]',
    daily_budget: input.dailyBudget,
    lifetime_budget: input.lifetimeBudget,
  }
  if (input.dailyBudget ?? input.lifetimeBudget) {
    fields['bid_strategy'] = 'LOWEST_COST_WITHOUT_CAP'
  }
  return post(`${config.adAccountId}/campaigns`, fields)
}

// --------------------------------------------------------------------- Ad set

export interface AdSetInput {
  name: string
  campaignId: string
  goal: string
  dailyBudget?: number
  lifetimeBudget?: number
  countries?: string[]
  ageMin?: number
  ageMax?: number
  genders?: 'all' | 'male' | 'female'
  pixelId?: string
  conversionEvent?: string
  leadFormId?: string
  startTime?: string
  endTime?: string
  activate?: boolean
}

const GENDER_CODES: Record<string, number[]> = { male: [1], female: [2] }

function buildTargeting(input: AdSetInput): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: input.countries ?? ['VN'] },
    age_min: input.ageMin ?? 18,
    age_max: input.ageMax ?? 65,
  }
  const codes = input.genders ? GENDER_CODES[input.genders] : undefined
  if (codes) targeting['genders'] = codes
  return targeting
}

function buildPromotedObject(input: AdSetInput, spec: Preset): string | undefined {
  if (spec.promoted === 'pixel') {
    if (!input.pixelId) {
      throw new Error('Mục tiêu "sales" cần --pixel <pixel-id> để đo chuyển đổi.')
    }
    return JSON.stringify({
      pixel_id: input.pixelId,
      custom_event_type: input.conversionEvent ?? 'PURCHASE',
    })
  }
  if (spec.promoted === 'page') return JSON.stringify({ page_id: config.pageId })
  return undefined
}

export async function createAdSet(input: AdSetInput): Promise<{ id: string }> {
  const spec = preset(input.goal)
  if (spec.needsLeadForm && !input.leadFormId) {
    throw new Error('Mục tiêu "leads" cần --lead-form <form-id> (form tạo sẵn trên Page).')
  }
  if (input.lifetimeBudget && !input.endTime) {
    throw new Error('Dùng --lifetime-budget thì bắt buộc có --end (thời điểm kết thúc).')
  }

  return post(`${config.adAccountId}/adsets`, {
    name: input.name,
    campaign_id: input.campaignId,
    status: status(input.activate),
    billing_event: 'IMPRESSIONS',
    optimization_goal: spec.optimizationGoal,
    destination_type: spec.destinationType,
    promoted_object: buildPromotedObject(input, spec),
    targeting: JSON.stringify(buildTargeting(input)),
    daily_budget: input.dailyBudget,
    lifetime_budget: input.lifetimeBudget,
    start_time: input.startTime,
    end_time: input.endTime,
  })
}

// ------------------------------------------------------------------- Creative

export interface CreativeInput {
  name: string
  goal: string
  /** Dùng lại một bài đã đăng trên Page; bỏ qua toàn bộ phần dựng nội dung bên dưới. */
  postId?: string
  message?: string
  headline?: string
  description?: string
  link?: string
  imagePath?: string
  pictureUrl?: string
  leadFormId?: string
}

/** Ảnh phải nằm trong thư viện của tài khoản quảng cáo trước, creative chỉ nhận hash. */
async function uploadImage(path: string): Promise<string> {
  const bytes = await readFile(path)
  const response = await post<{ images: Record<string, { hash: string }> }>(
    `${config.adAccountId}/adimages`,
    { source: new File([new Uint8Array(bytes)], basename(path)) },
  )
  const uploaded = Object.values(response.images ?? {})[0]
  if (!uploaded) throw new Error('Facebook không trả về hash ảnh sau khi upload.')
  return uploaded.hash
}

function buildCallToAction(input: CreativeInput, spec: Preset, link: string): Record<string, unknown> {
  if (spec.callToAction === 'MESSAGE_PAGE') {
    return { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } }
  }
  if (spec.needsLeadForm) {
    return { type: spec.callToAction, value: { lead_gen_form_id: input.leadFormId } }
  }
  return { type: spec.callToAction, value: { link } }
}

export async function createCreative(input: CreativeInput): Promise<{ id: string }> {
  const spec = preset(input.goal)

  if (input.postId) {
    return post(`${config.adAccountId}/adcreatives`, {
      name: input.name,
      object_story_id: input.postId,
    })
  }

  // Quảng cáo tin nhắn không có website để dẫn tới, Meta yêu cầu trỏ về chính Page.
  const link = input.link ?? `https://www.facebook.com/${config.pageId}`
  if (!input.link && spec.destinationType === 'WEBSITE') {
    throw new Error(`Mục tiêu "${input.goal}" cần --link <url> đích.`)
  }
  if (spec.needsLeadForm && !input.leadFormId) {
    throw new Error('Mục tiêu "leads" cần --lead-form <form-id>.')
  }

  const linkData: Record<string, unknown> = {
    link,
    message: input.message,
    name: input.headline,
    description: input.description,
    call_to_action: buildCallToAction(input, spec, link),
  }
  if (input.imagePath) linkData['image_hash'] = await uploadImage(input.imagePath)
  else if (input.pictureUrl) linkData['picture'] = input.pictureUrl

  return post(`${config.adAccountId}/adcreatives`, {
    name: input.name,
    object_story_spec: JSON.stringify({ page_id: config.pageId, link_data: linkData }),
    degrees_of_freedom_spec: JSON.stringify({
      creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } },
    }),
  })
}

// ------------------------------------------------------------------------- Ad

export interface AdInput {
  name: string
  adsetId: string
  creativeId: string
  activate?: boolean
}

export function createAd(input: AdInput): Promise<{ id: string }> {
  return post(`${config.adAccountId}/ads`, {
    name: input.name,
    adset_id: input.adsetId,
    creative: JSON.stringify({ creative_id: input.creativeId }),
    status: status(input.activate),
  })
}

// ------------------------------------------------------- Lên camp một phát ăn ngay

export type LaunchInput = CampaignInput & Omit<AdSetInput, 'campaignId'> & CreativeInput

export interface LaunchResult {
  campaign_id: string
  adset_id: string
  creative_id: string
  ad_id: string
  status: string
}

/**
 * Marketing API không có endpoint tạo cả cụm một lần: bắt buộc 4 lời gọi nối tiếp
 * và mỗi cái cần ID của cái trước. Thất bại giữa chừng sẽ để lại object mồ côi ở
 * trạng thái PAUSED — không tốn tiền, nhưng nên xoá tay cho sạch tài khoản.
 */
export async function launch(input: LaunchInput): Promise<LaunchResult> {
  const campaign = await createCampaign(input)
  const adset = await createAdSet({ ...input, campaignId: campaign.id })
  const creative = await createCreative({ ...input, name: `${input.name} — creative` })
  const ad = await createAd({
    name: input.name,
    adsetId: adset.id,
    creativeId: creative.id,
    activate: input.activate,
  })
  return {
    campaign_id: campaign.id,
    adset_id: adset.id,
    creative_id: creative.id,
    ad_id: ad.id,
    status: status(input.activate),
  }
}

// ----------------------------------------------------------------- Vỏ bọc CLI

function number(args: Args, name: string): number | undefined {
  const raw = args.flags[name]
  if (raw === undefined || raw === 'true') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`--${name} phải là số`)
  return value
}

function list(args: Args, name: string): string[] | undefined {
  const raw = args.flags[name]
  if (raw === undefined || raw === 'true') return undefined
  return raw.split(',').map((item) => item.trim().toUpperCase())
}

function genders(args: Args): 'all' | 'male' | 'female' | undefined {
  const raw = args.flags['genders']
  if (raw === undefined || raw === 'true') return undefined
  if (raw !== 'all' && raw !== 'male' && raw !== 'female') {
    throw new Error('--genders chỉ nhận all, male hoặc female')
  }
  return raw
}

function common(args: Args): Omit<LaunchInput, 'name' | 'goal'> {
  return {
    dailyBudget: number(args, 'daily-budget'),
    lifetimeBudget: number(args, 'lifetime-budget'),
    countries: list(args, 'countries'),
    ageMin: number(args, 'age-min'),
    ageMax: number(args, 'age-max'),
    genders: genders(args),
    pixelId: args.flags['pixel'],
    conversionEvent: args.flags['event'],
    leadFormId: args.flags['lead-form'],
    startTime: args.flags['start'],
    endTime: args.flags['end'],
    activate: args.flags['activate'] === 'true',
    postId: args.flags['post-id'],
    message: args.flags['message'],
    headline: args.flags['headline'],
    description: args.flags['description'],
    link: args.flags['link'],
    imagePath: args.flags['image'],
    pictureUrl: args.flags['picture'],
  }
}

export async function campaignCreate(args: Args): Promise<void> {
  const result = await createCampaign({
    ...common(args),
    name: requireFlag(args, 'name'),
    goal: requireFlag(args, 'goal'),
  })
  console.log(`Đã tạo campaign ${result.id} (${status(args.flags['activate'] === 'true')})`)
}

export async function adsetCreate(args: Args): Promise<void> {
  const result = await createAdSet({
    ...common(args),
    name: requireFlag(args, 'name'),
    goal: requireFlag(args, 'goal'),
    campaignId: requireFlag(args, 'campaign'),
  })
  console.log(`Đã tạo ad set ${result.id} (${status(args.flags['activate'] === 'true')})`)
}

export async function creativeCreate(args: Args): Promise<void> {
  const result = await createCreative({
    ...common(args),
    name: requireFlag(args, 'name'),
    goal: requireFlag(args, 'goal'),
  })
  console.log(`Đã tạo creative ${result.id}`)
}

export async function adCreate(args: Args): Promise<void> {
  const result = await createAd({
    name: requireFlag(args, 'name'),
    adsetId: requireFlag(args, 'adset'),
    creativeId: requireFlag(args, 'creative'),
    activate: args.flags['activate'] === 'true',
  })
  console.log(`Đã tạo ad ${result.id} (${status(args.flags['activate'] === 'true')})`)
}

export async function launchCmd(args: Args): Promise<void> {
  const result = await launch({
    ...common(args),
    name: requireFlag(args, 'name'),
    goal: requireFlag(args, 'goal'),
  })
  console.table([result])
  if (result.status === 'PAUSED') {
    console.log('\nCamp đang PAUSED. Kiểm tra lại rồi bật bằng:')
    console.log(`  npm run fb -- ads:toggle ${result.campaign_id} --status ACTIVE`)
  }
}
