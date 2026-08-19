import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { config } from '../config.js'
import { del, get, paginate, post } from '../graph.js'
import type { Params } from '../graph.js'
import { table, truncate } from '../output.js'
import type { Row } from '../output.js'
import type { Args } from '../util.js'
import { requireFlag, requirePositional } from '../util.js'

interface Post {
  id: string
  message?: string
  created_time: string
  permalink_url?: string
  comments?: { summary?: { total_count?: number } }
  reactions?: { summary?: { total_count?: number } }
  shares?: { count?: number }
}

/** Dùng chung cho lệnh posts:list và cho báo cáo tổng hợp. */
export async function fetchPosts(args: Args): Promise<Row[]> {
  const limit = Number(args.flags['limit'] ?? 25)
  const posts = await paginate<Post>(
    `${config.pageId}/published_posts`,
    {
      fields:
        'id,message,created_time,permalink_url,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)',
      since: args.flags['since'],
      until: args.flags['until'],
    },
    limit,
  )

  return posts.map((item) => ({
    id: item.id,
    created: item.created_time.slice(0, 16).replace('T', ' '),
    message: truncate(item.message, 50),
    reactions: item.reactions?.summary?.total_count ?? 0,
    comments: item.comments?.summary?.total_count ?? 0,
    shares: item.shares?.count ?? 0,
    permalink: item.permalink_url ?? '',
  }))
}

export async function list(args: Args): Promise<void> {
  table(await fetchPosts(args))
}

async function photoSource(photo: string): Promise<Params> {
  if (/^https?:\/\//.test(photo)) return { url: photo }
  const bytes = await readFile(photo)
  return { source: new File([new Uint8Array(bytes)], basename(photo)) }
}

export async function create(args: Args): Promise<void> {
  const message = requireFlag(args, 'message')
  const photo = args.flags['photo']
  const link = args.flags['link']
  const schedule = args.flags['schedule']

  const scheduling: Params = schedule
    ? { published: false, scheduled_publish_time: Math.floor(new Date(schedule).getTime() / 1000) }
    : {}

  if (schedule && Number.isNaN(Number(scheduling['scheduled_publish_time']))) {
    throw new Error(`--schedule không phải thời điểm hợp lệ: ${schedule}`)
  }

  const result = photo
    ? await post<{ id: string; post_id?: string }>(`${config.pageId}/photos`, {
        caption: message,
        ...(await photoSource(photo)),
        ...scheduling,
      })
    : await post<{ id: string }>(`${config.pageId}/feed`, { message, link, ...scheduling })

  const id = 'post_id' in result && result.post_id ? result.post_id : result.id
  console.log(schedule ? `Đã lên lịch bài viết: ${id}` : `Đã đăng bài: ${id}`)
}

export async function remove(args: Args): Promise<void> {
  const postId = requirePositional(args, 0, 'post-id')
  await del(postId)
  console.log(`Đã xóa bài viết ${postId}`)
}

export async function insights(args: Args): Promise<void> {
  const postId = requirePositional(args, 0, 'post-id')
  const metrics =
    args.flags['metrics'] ??
    'post_impressions,post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total'

  const response = await get<{ data: Array<{ name: string; values: Array<{ value: unknown }> }> }>(
    `${postId}/insights`,
    { metric: metrics },
  )

  table(
    response.data.map((insight) => {
      const value = insight.values[0]?.value
      return {
        metric: insight.name,
        value: typeof value === 'object' ? truncate(JSON.stringify(value), 70) : value,
      }
    }),
  )
}
