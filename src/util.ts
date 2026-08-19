export interface Args {
  positional: string[]
  flags: Record<string, string>
}

export function requireFlag(args: Args, name: string): string {
  const value = args.flags[name]
  if (!value || value === 'true') throw new Error(`Thiếu tham số --${name}`)
  return value
}

export function requirePositional(args: Args, index: number, label: string): string {
  const value = args.positional[index]
  if (!value) throw new Error(`Thiếu đối số <${label}>`)
  return value
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Mặc định lấy 30 ngày gần nhất nếu không truyền --since/--until. */
export function dateRange(args: Args): { since: string; until: string } {
  const until = args.flags['until'] ?? isoDate(new Date())
  const since =
    args.flags['since'] ?? isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  return { since, until }
}
