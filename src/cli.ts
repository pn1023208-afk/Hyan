import { GraphError } from './graph.js'
import type { Args } from './util.js'
import * as ads from './commands/ads.js'
import * as comments from './commands/comments.js'
import * as launch from './commands/launch.js'
import * as pages from './commands/pages.js'
import * as posts from './commands/posts.js'
import * as report from './commands/report.js'
import * as token from './commands/token.js'

interface Command {
  usage: string
  desc: string
  run: (args: Args) => Promise<void>
}

const COMMANDS: Record<string, Command> = {
  'token:check': {
    usage: 'token:check',
    desc: 'Kiểm tra token còn sống và liệt kê quyền đang có',
    run: token.check,
  },

  'token:extend': {
    usage: 'token:extend',
    desc: 'Đổi token cá nhân ngắn hạn lấy token ~60 ngày (cần FB_APP_ID + FB_APP_SECRET)',
    run: token.extend,
  },

  'pages:list': {
    usage: 'pages:list',
    desc: 'Liệt kê các fanpage mà token truy cập được',
    run: pages.list,
  },
  'pages:info': {
    usage: 'pages:info',
    desc: 'Thông tin fanpage đang cấu hình trong .env',
    run: pages.info,
  },
  'pages:insights': {
    usage: 'pages:insights [--since 2026-07-01] [--until 2026-08-01] [--period day|week] [--metrics a,b]',
    desc: 'Chỉ số của fanpage theo ngày',
    run: pages.insights,
  },

  'posts:list': {
    usage: 'posts:list [--limit 25] [--since ...] [--until ...]',
    desc: 'Danh sách bài viết đã đăng kèm tương tác',
    run: posts.list,
  },
  'posts:create': {
    usage: 'posts:create --message "..." [--link url] [--photo url|đường/dẫn.jpg] [--schedule 2026-08-20T09:00:00]',
    desc: 'Đăng bài text, link hoặc ảnh; có --schedule thì hẹn giờ',
    run: posts.create,
  },
  'posts:delete': {
    usage: 'posts:delete <post-id>',
    desc: 'Xóa một bài viết',
    run: posts.remove,
  },
  'posts:insights': {
    usage: 'posts:insights <post-id> [--metrics a,b]',
    desc: 'Chỉ số của một bài viết',
    run: posts.insights,
  },

  'comments:list': {
    usage: 'comments:list <post-id> [--limit 50]',
    desc: 'Danh sách comment của một bài viết',
    run: comments.list,
  },
  'comments:reply': {
    usage: 'comments:reply <comment-id> --message "..."',
    desc: 'Trả lời một comment',
    run: comments.reply,
  },
  'comments:hide': {
    usage: 'comments:hide <comment-id> [--show]',
    desc: 'Ẩn comment; thêm --show để hiện lại',
    run: comments.hide,
  },
  'comments:delete': {
    usage: 'comments:delete <comment-id>',
    desc: 'Xóa một comment',
    run: comments.remove,
  },

  'ads:accounts': {
    usage: 'ads:accounts',
    desc: 'Liệt kê tài khoản quảng cáo truy cập được',
    run: ads.accounts,
  },
  'ads:campaigns': {
    usage: 'ads:campaigns [--status ACTIVE]',
    desc: 'Danh sách campaign kèm ngân sách',
    run: ads.campaigns,
  },
  'ads:adsets': {
    usage: 'ads:adsets [--campaign <campaign-id>]',
    desc: 'Danh sách ad set',
    run: ads.adsets,
  },
  'ads:insights': {
    usage: 'ads:insights [--level campaign|adset|ad|account] [--since ...] [--until ...]',
    desc: 'Báo cáo chi phí và hiệu quả quảng cáo',
    run: ads.insights,
  },
  'ads:toggle': {
    usage: 'ads:toggle <id> --status ACTIVE|PAUSED',
    desc: 'Bật hoặc tạm dừng campaign / ad set / ad',
    run: ads.toggle,
  },
  'ads:launch': {
    usage:
      'ads:launch --name "..." --goal messages|sales|leads|traffic|engagement --daily-budget 200000 ' +
      '[--message "..."] [--link url] [--image ./anh.jpg] [--post-id <id>] [--pixel <id>] ' +
      '[--lead-form <id>] [--countries VN] [--age-min 18] [--age-max 65] [--activate]',
    desc: 'Lên camp trọn gói: campaign + ad set + creative + ad. Mặc định tạo ở trạng thái PAUSED',
    run: launch.launchCmd,
  },
  'ads:campaign:create': {
    usage: 'ads:campaign:create --name "..." --goal <goal> [--daily-budget 200000] [--activate]',
    desc: 'Chỉ tạo campaign. Có ngân sách ở đây là bật CBO',
    run: launch.campaignCreate,
  },
  'ads:adset:create': {
    usage:
      'ads:adset:create --name "..." --campaign <campaign-id> --goal <goal> [--daily-budget 200000] ' +
      '[--countries VN] [--age-min 18] [--age-max 65] [--genders all|male|female] [--pixel <id>] ' +
      '[--event PURCHASE] [--lead-form <id>] [--start ...] [--end ...] [--activate]',
    desc: 'Chỉ tạo ad set: ngân sách, nhắm chọn đối tượng và mục tiêu tối ưu',
    run: launch.adsetCreate,
  },
  'ads:creative:create': {
    usage:
      'ads:creative:create --name "..." --goal <goal> [--post-id <page_post_id>] [--message "..."] ' +
      '[--headline "..."] [--link url] [--image ./anh.jpg]',
    desc: 'Chỉ tạo creative, từ bài đã đăng (--post-id) hoặc dựng mới',
    run: launch.creativeCreate,
  },
  'ads:ad:create': {
    usage: 'ads:ad:create --name "..." --adset <adset-id> --creative <creative-id> [--activate]',
    desc: 'Ghép creative vào ad set thành một ad chạy được',
    run: launch.adCreate,
  },

  report: {
    usage: 'report [--since ...] [--until ...] [--out thư/mục]',
    desc: 'Xuất page insights + bài viết + quảng cáo ra 3 file CSV',
    run: report.build,
  },
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags: Record<string, string> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[key] = 'true'
    } else {
      flags[key] = next
      i++
    }
  }
  return { positional, flags }
}

function printHelp(): void {
  console.log('fb-manager — quản lý fanpage, bài viết, comment và quảng cáo Facebook\n')
  console.log('Cách dùng: npm run fb -- <lệnh> [đối số] [--cờ giá trị]\n')
  let group = ''
  for (const [name, command] of Object.entries(COMMANDS)) {
    const prefix = name.split(':')[0]!
    if (prefix !== group) {
      console.log('')
      group = prefix
    }
    console.log(`  ${command.usage}`)
    console.log(`      ${command.desc}`)
  }
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2)

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    printHelp()
    return
  }

  const command = COMMANDS[name]
  if (!command) {
    console.error(`Không có lệnh "${name}". Chạy "npm run fb -- --help" để xem danh sách.`)
    process.exitCode = 1
    return
  }

  await command.run(parseArgs(rest))
}

main().catch((error: unknown) => {
  if (error instanceof GraphError) {
    console.error(`\nLỗi Facebook API (code ${error.code}${error.subcode ? `/${error.subcode}` : ''}):`)
    console.error(`  ${error.message}`)
    if (error.code === 190) console.error('  → Token hết hạn hoặc bị thu hồi. Tạo lại System User token.')
    if (error.code === 200 || error.code === 10) console.error('  → Thiếu quyền. Kiểm tra bằng: npm run fb -- token:check')
    if (error.code === 100) console.error('  → Sai tham số hoặc field không tồn tại ở phiên bản API này.')
  } else {
    console.error(`\nLỗi: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exitCode = 1
})
