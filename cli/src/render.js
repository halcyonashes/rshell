import chalk from 'chalk'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import { state } from './state.js'

const termRenderer = new TerminalRenderer({ unescape: true })

export function md(text) {
  if (!text) return ''
  const clean = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  try {
    return marked(clean, { renderer: termRenderer }).trimEnd()
  } catch {
    return clean.trimEnd()
  }
}

export function timeAgo(utcSeconds) {
  const secs = Math.floor(Date.now() / 1000) - utcSeconds
  if (secs < 60) return 'just now'
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

export function renderPost(data, index) {
  const time = timeAgo(data.created_utc)
  const idx   = chalk.green(`[${index}]`)
  const title  = chalk.bold(data.title)
  const domain = chalk.dim(`(${data.domain})`)
  const sub    = chalk.yellow(`/r/${data.subreddit}`)
  const author = chalk.cyan(data.author)
  const score  = chalk.yellow(String(data.ups))
  const cmts   = chalk.dim(`${data.num_comments} comments`)
  const url    = (!data.is_self && data.url)
    ? '\n  ' + chalk.dim.underline(data.url.replace(/&amp;/g, '&'))
    : ''

  return [
    `${idx} ${title} ${domain}${url}`,
    `   ${chalk.dim('submitted')} ${chalk.dim(time)} ${chalk.dim('by')} ${author} ${chalk.dim('to')} ${sub}`,
    `   ${score} upvotes · ${cmts}`,
    '',
  ].join('\n')
}

export function renderSubreddit(data, index) {
  const idx   = chalk.green(`[${index}]`)
  const name  = chalk.yellow(`/r/${data.display_name}`)
  const title  = chalk.bold(data.title)
  const desc   = chalk.dim((data.public_description || '').slice(0, 100))
  const subs   = chalk.cyan(`${(data.subscribers || 0).toLocaleString()} subscribers`)
  const time   = timeAgo(data.created_utc)

  return [
    `${idx} ${name} — ${title}`,
    `   ${desc}`,
    `   ${subs} · started ${time}`,
    '',
  ].join('\n')
}

export function renderPostHeader(data) {
  const time   = timeAgo(data.created_utc)
  const title  = chalk.bold(data.title)
  const domain = chalk.dim(`(${data.domain})`)
  const sub    = chalk.yellow(`/r/${data.subreddit}`)
  const author = chalk.cyan(data.author)
  const score  = chalk.yellow(String(data.ups))
  const cmts   = chalk.dim(`${data.num_comments} comments`)
  const url    = (!data.is_self && data.url)
    ? '\n' + chalk.dim.underline(data.url.replace(/&amp;/g, '&')) + '\n'
    : ''

  const hr = chalk.dim('─'.repeat(70))
  let out = `\n${hr}\n${title} ${domain}${url}\n`
  if (data.selftext) out += md(data.selftext) + '\n'
  out += `${chalk.dim('submitted')} ${chalk.dim(time)} ${chalk.dim('by')} ${author} ${chalk.dim('to')} ${sub}\n`
  out += `${score} upvotes · ${cmts}\n${hr}\n`
  return out
}

// Recursively renders a Reddit comment listing into lines.
// Mutates state.comments[] and state.fullnames[] as side effects (same as original).
export function renderCommentTree(children, depth = 0) {
  const lines = []
  const pad = depth > 0 ? chalk.dim('│ ').repeat(depth) : ''

  for (const child of children) {
    if (child.kind === 't1') {
      const d = child.data
      const idx    = chalk.green(`[${state.commentCount}]`)
      const author = chalk.cyan(d.author)
      const score  = chalk.yellow(String(d.ups))
      const time   = chalk.dim(timeAgo(d.created_utc))

      // register for indexing
      if (state.jsonBase) {
        state.comments[state.commentCount] = `${state.jsonBase}${d.id}`
      }
      state.fullnames[state.commentCount] = d.name
      state.commentCount++

      const header = `${pad}${idx} ${score} · ${author} · ${time}`
      const body = md(d.body || '')
        .split('\n')
        .map(l => pad + '  ' + l)
        .join('\n')

      lines.push(header + '\n' + body + '\n')

      if (d.replies && typeof d.replies === 'object' && d.replies.data) {
        lines.push(...renderCommentTree(d.replies.data.children, depth + 1))
      }
    } else if (child.kind === 'more' && child.data.count > 0) {
      const cnt = child.data.count
      const verb = cnt === 1 ? 'reply' : 'replies'
      const ids = child.data.children
      state.morelink = `https://www.reddit.com/api/morechildren.json?link_id=${child.data.parent_id}&children=${ids.join(',')}&api_type=json`
      lines.push(chalk.cyan(`${pad}[load more comments (${cnt} ${verb})] → type: view more comments\n`))
    }
  }

  return lines
}

export function renderNav() {
  const parts = []
  if (state.prevUrl) parts.push(chalk.cyan('[previous]'))
  if (state.nextUrl) parts.push(chalk.cyan('[next]'))
  return parts.length ? '\n' + parts.join('  ') + '\n' : ''
}

export function prompt() {
  let p = chalk.cyan(state.authUser) + chalk.dim('@reddit:')
  p += chalk.yellow(state.pwd === '/' ? '~' : '~' + state.pwd)
  return p + chalk.green('$ ')
}
