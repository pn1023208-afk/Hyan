import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { config } from './config.js'
import { del, get, GraphError, paginate, post } from './graph.js'
import type { Params } from './graph.js'
import { launch } from './commands/launch.js'

const server = new McpServer({ name: 'fb-manager', version: '0.1.0' })

type Result = CallToolResult

function ok(data: unknown): Result {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

/**
 * Giữ nguyên mã lỗi của Meta trong câu trả lời: code là thứ duy nhất tra cứu được
 * trong tài liệu, còn message thì Meta đổi chữ thường xuyên.
 */
function fail(error: unknown): Result {
  if (error instanceof GraphError) {
    const subcode = error.subcode ? `/${error.subcode}` : ''
    return {
      content: [{ type: 'text', text: `Graph API lỗi (code ${error.code}${subcode}): ${error.message}` }],
      isError: true,
    }
  }
  return { content: [{ type: 'text', text: `Lỗi: ${String(error)}` }], isError: true }
}

function register<S extends z.ZodRawShape>(
  name: string,
  meta: { title: string; description: string; input: S; readOnly?: boolean; destructive?: boolean },
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    {
      title: meta.title,
      description: meta.description,
      inputSchema: meta.input,
      annotations: {
        readOnlyHint: meta.readOnly ?? false,
        destructiveHint: meta.destructive ?? false,
      },
    },
    // ToolCallback của SDK là kiểu điều kiện trên shape; shape ở đây là generic nên
    // TypeScript không rút gọn được. Ép kiểu gói gọn tại đúng chỗ này.
    (async (args: unknown): Promise<Result> => {
      try {
        return ok(await handler(args as z.infer<z.ZodObject<S>>))
      } catch (error) {
        return fail(error)
      }
    }) as never,
  )
}

const limitArg = z.number().int().min(1).max(200).default(25).describe('Số bản ghi tối đa')

// ---------------------------------------------------------------- Nội dung Page

register(
  'fb_pages_list',
  {
    title: 'Danh sách Page',
    description: 'Liệt kê các Page mà access token hiện tại quản lý được. Dùng để lấy FB_PAGE_ID.',
    input: {},
    readOnly: true,
  },
  () => paginate('me/accounts', { fields: 'id,name,category,fan_count,tasks' }),
)

register(
  'fb_page_info',
  {
    title: 'Thông tin Page',
    description: 'Thông tin tổng quan của Page đang cấu hình trong FB_PAGE_ID.',
    input: {},
    readOnly: true,
  },
  () => get(config.pageId, { fields: 'id,name,category,about,link,fan_count,followers_count' }),
)

register(
  'fb_posts_list',
  {
    title: 'Danh sách bài viết',
    description: 'Các bài viết gần nhất của Page, mới nhất trước. Bao gồm cả bài đã lên lịch chưa đăng.',
    input: { limit: limitArg },
    readOnly: true,
  },
  ({ limit }) =>
    paginate(
      `${config.pageId}/posts`,
      { fields: 'id,message,created_time,permalink_url,is_published,scheduled_publish_time' },
      limit,
    ),
)

register(
  'fb_post_create',
  {
    title: 'Đăng bài',
    description:
      'Đăng bài chữ (kèm link tuỳ chọn) lên Page. Muốn hẹn giờ thì truyền scheduled_publish_time; ' +
      'Meta yêu cầu mốc hẹn cách hiện tại từ 10 phút đến 6 tháng.',
    input: {
      message: z.string().min(1).describe('Nội dung bài viết'),
      link: z.string().url().optional().describe('URL đính kèm'),
      scheduled_publish_time: z
        .number()
        .int()
        .optional()
        .describe('Unix timestamp (giây) để hẹn giờ đăng. Bỏ trống là đăng ngay.'),
    },
    readOnly: false,
  },
  ({ message, link, scheduled_publish_time }) => {
    const fields: Params = { message, link }
    if (scheduled_publish_time !== undefined) {
      fields['published'] = false
      fields['scheduled_publish_time'] = scheduled_publish_time
    }
    return post(`${config.pageId}/feed`, fields)
  },
)

register(
  'fb_photo_post',
  {
    title: 'Đăng ảnh',
    description: 'Đăng ảnh lên Page. Truyền image_url (ảnh công khai trên mạng) hoặc image_path (file trên máy).',
    input: {
      caption: z.string().optional().describe('Chú thích cho ảnh'),
      image_url: z.string().url().optional().describe('URL ảnh công khai'),
      image_path: z.string().optional().describe('Đường dẫn file ảnh trên máy'),
    },
    readOnly: false,
  },
  async ({ caption, image_url, image_path }) => {
    if (!image_url === !image_path) {
      throw new Error('Cần đúng một trong hai: image_url hoặc image_path.')
    }
    const fields: Params = { caption }
    if (image_url) {
      fields['url'] = image_url
    } else {
      const bytes = await readFile(image_path!)
      fields['source'] = new File([new Uint8Array(bytes)], basename(image_path!))
    }
    return post(`${config.pageId}/photos`, fields)
  },
)

register(
  'fb_post_update',
  {
    title: 'Sửa bài viết',
    description: 'Đổi nội dung chữ của một bài đã đăng. Không sửa được ảnh hay link đính kèm.',
    input: {
      post_id: z.string().describe('ID bài viết'),
      message: z.string().min(1).describe('Nội dung mới'),
    },
    readOnly: false,
  },
  ({ post_id, message }) => post(post_id, { message }),
)

register(
  'fb_post_delete',
  {
    title: 'Xoá bài viết',
    description: 'Xoá vĩnh viễn một bài viết của Page. Không hoàn tác được.',
    input: { post_id: z.string().describe('ID bài viết') },
    destructive: true,
  },
  ({ post_id }) => del(post_id),
)

// ---------------------------------------------------------- Tương tác & bình luận

register(
  'fb_comments_list',
  {
    title: 'Danh sách bình luận',
    description: 'Bình luận của một bài viết. object_id có thể là ID bài viết hoặc ID một bình luận (để lấy phản hồi).',
    input: {
      object_id: z.string().describe('ID bài viết hoặc ID bình luận'),
      limit: limitArg,
      order: z.enum(['chronological', 'reverse_chronological']).default('reverse_chronological'),
    },
    readOnly: true,
  },
  ({ object_id, limit, order }) =>
    paginate(
      `${object_id}/comments`,
      { fields: 'id,message,from,created_time,like_count,comment_count,is_hidden', order },
      limit,
    ),
)

register(
  'fb_comment_reply',
  {
    title: 'Trả lời bình luận',
    description: 'Đăng một phản hồi dưới bình luận chỉ định.',
    input: {
      comment_id: z.string().describe('ID bình luận'),
      message: z.string().min(1).describe('Nội dung trả lời'),
    },
    readOnly: false,
  },
  ({ comment_id, message }) => post(`${comment_id}/comments`, { message }),
)

register(
  'fb_comment_moderate',
  {
    title: 'Kiểm duyệt bình luận',
    description: 'Ẩn, bỏ ẩn hoặc xoá một bình luận. Ẩn thì người viết vẫn thấy bình luận của họ, xoá thì mất hẳn.',
    input: {
      comment_id: z.string().describe('ID bình luận'),
      action: z.enum(['hide', 'unhide', 'delete']).describe('Hành động cần thực hiện'),
    },
    destructive: true,
  },
  ({ comment_id, action }) => {
    if (action === 'delete') return del(comment_id)
    return post(comment_id, { is_hidden: action === 'hide' })
  },
)

register(
  'fb_conversations_list',
  {
    title: 'Hộp thư Page',
    description: 'Các cuộc hội thoại tin nhắn gần nhất của Page, kèm đoạn tin cuối.',
    input: { limit: limitArg },
    readOnly: true,
  },
  ({ limit }) =>
    paginate(
      `${config.pageId}/conversations`,
      { fields: 'id,snippet,updated_time,unread_count,participants' },
      limit,
    ),
)

// ------------------------------------------------------------ Insights / thống kê

register(
  'fb_page_insights',
  {
    title: 'Thống kê Page',
    description:
      'Số liệu tổng quan của Page. Meta khai tử metric khá thường xuyên; nếu báo lỗi metric không hợp lệ ' +
      'thì tra changelog Graph API để đổi tên metric.',
    input: {
      metrics: z
        .string()
        .default('page_impressions,page_post_engagements,page_fans')
        .describe('Danh sách metric, cách nhau bởi dấu phẩy'),
      period: z.enum(['day', 'week', 'days_28']).default('day'),
      since: z.string().optional().describe('Ngày bắt đầu, dạng YYYY-MM-DD'),
      until: z.string().optional().describe('Ngày kết thúc, dạng YYYY-MM-DD'),
    },
    readOnly: true,
  },
  ({ metrics, period, since, until }) =>
    get(`${config.pageId}/insights`, { metric: metrics, period, since, until }),
)

register(
  'fb_post_insights',
  {
    title: 'Thống kê bài viết',
    description: 'Số liệu hiệu quả của một bài viết cụ thể.',
    input: {
      post_id: z.string().describe('ID bài viết'),
      metrics: z
        .string()
        .default('post_impressions,post_engaged_users,post_clicks,post_reactions_by_type_total')
        .describe('Danh sách metric, cách nhau bởi dấu phẩy'),
    },
    readOnly: true,
  },
  ({ post_id, metrics }) => get(`${post_id}/insights`, { metric: metrics }),
)

// ------------------------------------------------------------------ Quảng cáo

const goalArg = z
  .enum(['messages', 'sales', 'leads', 'traffic', 'engagement'])
  .describe(
    'Mục tiêu: messages = tin nhắn Messenger, sales = chuyển đổi website (cần pixel_id), ' +
      'leads = form thu lead (cần lead_form_id), traffic = kéo click về web, engagement = tương tác bài viết',
  )

register(
  'fb_ads_accounts',
  {
    title: 'Tài khoản quảng cáo',
    description: 'Liệt kê tài khoản quảng cáo token truy cập được. Dùng để lấy FB_AD_ACCOUNT_ID.',
    input: {},
    readOnly: true,
  },
  () => paginate('me/adaccounts', { fields: 'id,name,account_status,currency,amount_spent' }),
)

register(
  'fb_ads_campaigns',
  {
    title: 'Danh sách campaign',
    description: 'Các campaign của tài khoản quảng cáo đang cấu hình, kèm ngân sách và trạng thái.',
    input: {
      effective_status: z.string().optional().describe('Lọc theo trạng thái, ví dụ ACTIVE hoặc PAUSED'),
      limit: limitArg,
    },
    readOnly: true,
  },
  ({ effective_status, limit }) =>
    paginate(
      `${config.adAccountId}/campaigns`,
      { fields: 'id,name,status,objective,daily_budget,lifetime_budget', effective_status },
      limit,
    ),
)

register(
  'fb_ads_adsets',
  {
    title: 'Danh sách ad set',
    description: 'Ad set của một campaign, hoặc của cả tài khoản nếu bỏ trống campaign_id.',
    input: {
      campaign_id: z.string().optional().describe('Giới hạn trong một campaign'),
      limit: limitArg,
    },
    readOnly: true,
  },
  ({ campaign_id, limit }) =>
    paginate(
      campaign_id ? `${campaign_id}/adsets` : `${config.adAccountId}/adsets`,
      { fields: 'id,name,status,daily_budget,optimization_goal,campaign_id' },
      limit,
    ),
)

register(
  'fb_ads_insights',
  {
    title: 'Báo cáo quảng cáo',
    description:
      'Chi phí và hiệu quả quảng cáo theo khoảng thời gian. Mảng actions chứa số lượt chuyển đổi ' +
      'theo từng loại (purchase, lead, link_click, post_engagement...).',
    input: {
      level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
      since: z.string().describe('Ngày bắt đầu, dạng YYYY-MM-DD'),
      until: z.string().describe('Ngày kết thúc, dạng YYYY-MM-DD'),
      limit: limitArg,
    },
    readOnly: true,
  },
  ({ level, since, until, limit }) =>
    paginate(
      `${config.adAccountId}/insights`,
      {
        level,
        fields:
          'campaign_name,adset_name,ad_name,impressions,reach,clicks,ctr,cpc,cpm,spend,actions',
        time_range: JSON.stringify({ since, until }),
      },
      limit,
    ),
)

register(
  'fb_ads_toggle',
  {
    title: 'Bật / tạm dừng quảng cáo',
    description: 'Đổi trạng thái của một campaign, ad set hoặc ad. Bật lên là bắt đầu tiêu tiền.',
    input: {
      object_id: z.string().describe('ID campaign, ad set hoặc ad'),
      status: z.enum(['ACTIVE', 'PAUSED']),
    },
    readOnly: false,
  },
  ({ object_id, status }) => post(object_id, { status }),
)

register(
  'fb_ads_launch',
  {
    title: 'Lên camp',
    description:
      'Tạo trọn bộ campaign + ad set + creative + ad. Mặc định để PAUSED, phải gọi fb_ads_toggle mới chạy. ' +
      'Ngân sách tính theo đơn vị nhỏ nhất của tiền tệ tài khoản (VND là đồng, USD là cent). ' +
      'Nội dung quảng cáo: hoặc truyền post_id để dùng lại bài đã đăng, hoặc truyền message + link + image_url.',
    input: {
      name: z.string().min(1).describe('Tên campaign'),
      goal: goalArg,
      daily_budget: z.number().int().positive().optional().describe('Ngân sách ngày, đặt ở ad set'),
      lifetime_budget: z.number().int().positive().optional().describe('Ngân sách trọn đời, cần kèm end_time'),
      message: z.string().optional().describe('Nội dung chính của quảng cáo'),
      headline: z.string().optional().describe('Tiêu đề ngắn hiển thị dưới ảnh'),
      link: z.string().url().optional().describe('URL đích, bắt buộc với goal sales và traffic'),
      image_url: z.string().url().optional().describe('URL ảnh công khai dùng làm hình quảng cáo'),
      post_id: z.string().optional().describe('Dùng lại bài đã đăng, dạng <page_id>_<post_id>'),
      pixel_id: z.string().optional().describe('Bắt buộc với goal sales'),
      conversion_event: z.string().optional().describe('Sự kiện chuyển đổi, mặc định PURCHASE'),
      lead_form_id: z.string().optional().describe('Bắt buộc với goal leads'),
      countries: z.array(z.string()).default(['VN']).describe('Mã quốc gia ISO, ví dụ VN'),
      age_min: z.number().int().min(13).max(65).default(18),
      age_max: z.number().int().min(13).max(65).default(65),
      genders: z.enum(['all', 'male', 'female']).default('all'),
      start_time: z.string().optional().describe('ISO 8601, ví dụ 2026-08-20T09:00:00+0700'),
      end_time: z.string().optional().describe('ISO 8601, bắt buộc khi dùng lifetime_budget'),
      activate: z.boolean().default(false).describe('Đặt true để chạy ngay thay vì tạo ở trạng thái PAUSED'),
    },
    readOnly: false,
  },
  (args) =>
    launch({
      name: args.name,
      goal: args.goal,
      dailyBudget: args.daily_budget,
      lifetimeBudget: args.lifetime_budget,
      message: args.message,
      headline: args.headline,
      link: args.link,
      pictureUrl: args.image_url,
      postId: args.post_id,
      pixelId: args.pixel_id,
      conversionEvent: args.conversion_event,
      leadFormId: args.lead_form_id,
      countries: args.countries,
      ageMin: args.age_min,
      ageMax: args.age_max,
      genders: args.genders,
      startTime: args.start_time,
      endTime: args.end_time,
      activate: args.activate,
    }),
)

await server.connect(new StdioServerTransport())
