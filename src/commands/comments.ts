import { del, paginate, post } from '../graph.js'
import { table, truncate } from '../output.js'
import type { Args } from '../util.js'
import { requireFlag, requirePositional } from '../util.js'

interface Comment {
  id: string
  message?: string
  created_time: string
  like_count?: number
  is_hidden?: boolean
  from?: { id: string; name: string }
}

export async function list(args: Args): Promise<void> {
  const postId = requirePositional(args, 0, 'post-id')
  const limit = Number(args.flags['limit'] ?? 50)

  const comments = await paginate<Comment>(
    `${postId}/comments`,
    {
      fields: 'id,message,created_time,like_count,is_hidden,from',
      filter: 'stream',
      order: 'reverse_chronological',
    },
    limit,
  )

  table(
    comments.map((comment) => ({
      id: comment.id,
      created: comment.created_time.slice(0, 16).replace('T', ' '),
      from: comment.from?.name ?? '(ẩn danh)',
      message: truncate(comment.message, 50),
      likes: comment.like_count ?? 0,
      hidden: comment.is_hidden ? 'yes' : '',
    })),
  )
}

export async function reply(args: Args): Promise<void> {
  const commentId = requirePositional(args, 0, 'comment-id')
  const result = await post<{ id: string }>(`${commentId}/comments`, {
    message: requireFlag(args, 'message'),
  })
  console.log(`Đã trả lời: ${result.id}`)
}

export async function hide(args: Args): Promise<void> {
  const commentId = requirePositional(args, 0, 'comment-id')
  const hidden = args.flags['show'] !== 'true'
  await post(commentId, { is_hidden: hidden })
  console.log(`${hidden ? 'Đã ẩn' : 'Đã hiện lại'} comment ${commentId}`)
}

export async function remove(args: Args): Promise<void> {
  const commentId = requirePositional(args, 0, 'comment-id')
  await del(commentId)
  console.log(`Đã xóa comment ${commentId}`)
}
