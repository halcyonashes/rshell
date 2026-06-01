import readline from 'readline'
import chalk from 'chalk'
import open from 'open'

import { state, resetListing } from './state.js'
import * as reddit from './reddit.js'
import * as auth from './auth.js'
import {
  renderPost, renderSubreddit, renderPostHeader,
  renderCommentTree, renderNav, prompt, timeAgo, md,
} from './render.js'

// ---------------------------------------------------------------------------
// Readline setup
// ---------------------------------------------------------------------------

const AUTOCOMPLETE_BASE = [
  'help', 'about', 'clear', 'pwd',
  'list', 'ls', 'subreddits',
  'view', 'watch', 'search', 'user',
  'upvote', 'downvote', 'post', 'next', 'previous',
  'login', 'logout', 'settings',
]
let autocomplete = [...AUTOCOMPLETE_BASE]

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer(line) {
    const hits = autocomplete.filter(c => c.startsWith(line))
    return [hits.length ? hits : autocomplete, line]
  },
})

function setPrompt() {
  rl.setPrompt(prompt())
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function print(msg) {
  process.stdout.write(msg + '\n')
}

function printErr(msg) {
  print(chalk.red('error: ') + msg)
}

function printOk(msg) {
  print(chalk.green('✓ ') + msg)
}

// ---------------------------------------------------------------------------
// Listing helpers — shared by list/search/user
// ---------------------------------------------------------------------------

function pushUniq(arr, item) {
  if (!arr.includes(item)) arr.push(item)
}

function registerForAutocomplete(items) {
  for (const item of items) {
    pushUniq(autocomplete, item)
  }
}

async function fetchAndPrintPosts(url) {
  const data = await reddit.fetchListingUrl(url)
  const items = data.data.children

  for (const child of items) {
    if (!child.data) continue
    const d = child.data
    state.content.push(d.url)
    state.posts.push('https://www.reddit.com' + d.permalink)
    state.fullnames.push(d.name)
    state.subreddits.push(d.subreddit)
    registerForAutocomplete([d.subreddit, d.author])
    print(renderPost(d, state.postCount++))
  }

  state.nextUrl = data.data.after
    ? rebuildNextUrl(url, data.data.after, state.postCount, 'after')
    : null
  state.prevUrl = data.data.before
    ? rebuildNextUrl(url, data.data.before, state.postCount, 'before')
    : null

  print(renderNav())
}

// Rebuild a pagination URL by swapping after/before params.
function rebuildNextUrl(originalUrl, cursor, count, dir) {
  try {
    const u = new URL(originalUrl)
    u.searchParams.delete('after')
    u.searchParams.delete('before')
    u.searchParams.delete('count')
    u.searchParams.set(dir, cursor)
    u.searchParams.set('count', String(count))
    return u.toString()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------

async function cmdList(args) {
  const [a0, a1] = args

  // next / previous (frontpage or subreddit)
  if (a0 === 'next' || a0 === 'previous') {
    const url = a0 === 'next' ? state.nextUrl : state.prevUrl
    if (!url) { printErr(`no ${a0} page`); return }
    resetListing()
    await fetchAndPrintPosts(url)
    return
  }

  // list subreddits [next|previous]
  if (a0 === 'subreddits') {
    if (a1 === 'next' || a1 === 'previous') {
      const url = a1 === 'next' ? state.nextUrl : state.prevUrl
      if (!url) { printErr(`no ${a1} page`); return }
      state.subCount = 0
      state.nextUrl = null
      state.prevUrl = null
      await fetchAndPrintSubs(url)
    } else {
      resetListing()
      state.pwd = '/subreddits'
      const url = `${reddit.listingBase()}/subreddits/.json?limit=${state.limit}`
      await fetchAndPrintSubs(url)
    }
    return
  }

  // list [subreddit] [sort] — or plain list (frontpage)
  const sub = a0
  const sort = ['new', 'rising', 'top', 'controversial', 'hot'].includes(a1) ? a1 : ''

  if (!sub) {
    // frontpage
    resetListing()
    state.pwd = '/'
    const url = `${reddit.listingBase()}/.json?limit=${state.limit}`
    await fetchAndPrintPosts(url)
    state.cmdStack.push(['list'])
    return
  }

  // subreddit [next|previous]
  if (a1 === 'next' || a1 === 'previous') {
    const url = a1 === 'next' ? state.nextUrl : state.prevUrl
    if (!url) { printErr(`no ${a1} page`); return }
    resetListing()
    await fetchAndPrintPosts(url)
    return
  }

  resetListing()
  state.pwd = `/r/${sub}`
  const path = sort ? `/r/${sub}/${sort}/` : `/r/${sub}/`
  const url = `${reddit.listingBase()}${path}.json?limit=${state.limit}`
  await fetchAndPrintPosts(url)
  state.cmdStack.push(['list', sub, ...(sort ? [sort] : [])])
}

async function fetchAndPrintSubs(url) {
  const data = await reddit.fetchListingUrl(url)
  for (const child of data.data.children) {
    if (!child.data) continue
    const d = child.data
    state.subreddits.push(d.display_name)
    pushUniq(autocomplete, d.display_name)
    print(renderSubreddit(d, state.subCount++))
  }
  state.nextUrl = data.data.after
    ? rebuildNextUrl(url, data.data.after, state.subCount, 'after')
    : null
  state.prevUrl = data.data.before
    ? rebuildNextUrl(url, data.data.before, state.subCount, 'before')
    : null
  print(renderNav())
}

// ---------------------------------------------------------------------------
// Command: watch
// ---------------------------------------------------------------------------

async function cmdWatch(args) {
  const [sub, sort] = args
  if (!sub) { printErr('usage: watch [subreddit]'); return }

  if (state.watchInterval) {
    clearInterval(state.watchInterval)
    state.watchInterval = null
  }

  state.stream.clear()
  resetListing()
  state.pwd = `/r/${sub}`

  const url = `${reddit.listingBase()}/r/${sub}/new/.json?limit=${state.limit}`

  // seed stream with existing post IDs so we don't repeat them on first poll
  const seed = await reddit.fetchListingUrl(url)
  for (const c of seed.data.children) {
    if (c.data) state.stream.add(c.data.id)
  }

  print(chalk.cyan(`watching /r/${sub} for new posts (every 15s) — press Enter to stop\n`))

  async function poll() {
    try {
      const data = await reddit.fetchListingUrl(url)
      for (const child of data.data.children) {
        if (!child.data) continue
        const d = child.data
        if (!state.stream.has(d.id)) {
          state.stream.add(d.id)
          state.content.push(d.url)
          state.posts.push('https://www.reddit.com' + d.permalink)
          state.fullnames.push(d.name)
          print(renderPost(d, state.postCount++))
          // redraw prompt after async output
          rl.prompt(true)
        }
      }
    } catch (e) {
      print(chalk.red(`watch error: ${e.message}`))
    }
  }

  state.watchInterval = setInterval(poll, 15_000)
}

// ---------------------------------------------------------------------------
// Command: view
// ---------------------------------------------------------------------------

async function cmdView(args) {
  const [a0, a1, a2, a3] = args

  // view content [index]
  if (a0 === 'content') {
    const idx = parseInt(a1)
    const url = state.content[idx]
    if (!url) { printErr(`no content at index ${idx}`); return }
    const clean = url.replace(/&amp;/g, '&')
    print(chalk.dim.underline(clean))
    await open(clean)
    return
  }

  // view more comments  (load hidden morechildren)
  if ((a0 === 'more' && a1 === 'comments') || (a0 === 'comments' && a1 === 'more') || a0 === 'more') {
    // view more comments [index]  — drill into a specific comment's replies
    const idx = parseInt(a2 ?? a1)
    if (!isNaN(idx) && state.comments[idx]) {
      const sort = a3 || ''
      const sortParam = sort ? `sort=${sort}&` : ''
      const data = await reddit.fetchListingUrl(`${state.comments[idx]}/.json?${sortParam}limit=${state.limit}`)
      state.commentCount = 0
      state.morelink = null

      // re-print post header
      const viewpost = data[0].data.children
      for (const c of viewpost) {
        if (c.kind === 't3') {
          print(renderPostHeader(c.data))
          break
        }
      }

      const lines = renderCommentTree(data[1].data.children)
      for (const l of lines) print(l)
      return
    }

    // view more comments (load morechildren for current post)
    if (!state.morelink) { printErr('no more comments to load'); return }
    const data = await reddit.fetchListingUrl(state.morelink)
    state.morelink = null
    const items = data.json.data.things
    const lines = renderCommentTree(items)
    for (const l of lines) print(l)
    return
  }

  // view comments [index] [sort]
  if (a0 === 'comments') {
    const idx = parseInt(a1)
    const sort = a2 || ''
    if (isNaN(idx) || !state.posts[idx]) { printErr(`no post at index ${idx}`); return }

    const postUrl = state.posts[idx]
    state.jsonBase = postUrl.endsWith('/') ? postUrl : postUrl + '/'
    const sortParam = sort ? `sort=${sort}&` : ''
    // posts[] use www.reddit.com — rewrite to oauth if authenticated
    const commentsUrl = state.token
      ? postUrl.replace(reddit.PUBLIC_BASE, reddit.OAUTH_BASE)
      : postUrl
    const data = await reddit.fetchListingUrl(`${commentsUrl}.json?${sortParam}limit=${state.limit}`)

    state.commentCount = 0
    state.morelink = null

    const viewpost = data[0].data.children
    for (const c of viewpost) {
      if (c.kind === 't3') {
        state.parentName = c.data.name
        state.parentPostText = renderPostHeader(c.data)
        state.pwd = c.data.permalink.replace(/\/$/, '')
        print(state.parentPostText)
        registerForAutocomplete([c.data.author])
        break
      }
    }

    const lines = renderCommentTree(data[1].data.children)
    for (const l of lines) print(l)
    state.cmdStack.push(['view', 'comments', String(idx), ...(sort ? [sort] : [])])
    return
  }

  printErr('usage: view comments [index] | view content [index] | view more comments [index]')
}

// ---------------------------------------------------------------------------
// Command: search
// ---------------------------------------------------------------------------

async function cmdSearch(args) {
  const [a0, ...rest] = args

  // search next / previous
  if (a0 === 'next' || a0 === 'previous') {
    const url = a0 === 'next' ? state.nextUrl : state.prevUrl
    if (!url) { printErr(`no ${a0} page`); return }
    resetListing()
    await fetchAndPrintPosts(url)
    return
  }

  const term = [a0, ...rest].join(' ')
  if (!term) { printErr('usage: search [term]'); return }

  state.searchTerm = term
  resetListing()
  state.pwd = '/search'

  const url = `${reddit.listingBase()}/search/.json?q=${encodeURIComponent(term)}&limit=${state.limit}`
  await fetchAndPrintPosts(url)
  state.cmdStack.push(['search', term])
}

// ---------------------------------------------------------------------------
// Command: user
// ---------------------------------------------------------------------------

async function cmdUser(args) {
  const [name, dir] = args
  if (!name) { printErr('usage: user [username]'); return }

  if (dir === 'next' || dir === 'previous') {
    const url = dir === 'next' ? state.nextUrl : state.prevUrl
    if (!url) { printErr(`no ${dir} page`); return }
    state.postCount = 0
    state.commentCount = 0
    await fetchAndPrintUserOverview(url, name)
    return
  }

  resetListing()
  state.pwd = `/user/${name}`
  const url = `${reddit.listingBase()}/user/${name}.json?limit=${state.limit}`
  await fetchAndPrintUserOverview(url, name)
  state.cmdStack.push(['user', name])
}

async function fetchAndPrintUserOverview(url, name) {
  const data = await reddit.fetchListingUrl(url)

  for (const child of data.data.children) {
    if (!child.data) continue
    const d = child.data

    if (child.kind === 't3') {
      // post
      state.content.push(d.url)
      state.posts.push('https://www.reddit.com' + d.permalink)
      state.fullnames.push(d.name)
      registerForAutocomplete([d.subreddit, d.author])
      print(renderPost(d, state.postCount++))
    } else if (child.kind === 't1') {
      // comment
      const linkId = d.link_id.replace(/^t[13]_/, '')
      const base = `https://www.reddit.com/r/${d.subreddit}/comments/${linkId}/`
      state.comments.push(`${base}${d.id}`)
      state.fullnames.push(d.name)
      state.jsonBase = base
      registerForAutocomplete([d.subreddit, d.author])

      const idx    = chalk.yellow(`[${state.commentCount}]`)
      const author = chalk.cyan(d.author)
      const score  = chalk.yellow(String(d.ups))
      const time   = chalk.dim(timeAgo(d.created_utc))
      const sub    = chalk.yellow(`/r/${d.subreddit}`)
      const body   = md(d.body || '')

      print(`${idx} ${score} · ${author} → ${sub} · ${time}\n  ${body.split('\n').join('\n  ')}\n`)
      state.commentCount++
    }
  }

  state.nextUrl = data.data.after
    ? rebuildNextUrl(url, data.data.after, state.postCount, 'after')
    : null
  state.prevUrl = data.data.before
    ? rebuildNextUrl(url, data.data.before, state.postCount, 'before')
    : null

  print(renderNav())
}

// ---------------------------------------------------------------------------
// Command: vote
// ---------------------------------------------------------------------------

async function cmdVote(args, dir) {
  const idx = parseInt(args[0])
  if (isNaN(idx)) { printErr(`usage: ${dir > 0 ? 'up' : 'down'}vote [index]`); return }
  if (!state.token) { printErr('not authenticated — type login first'); return }
  const fullname = state.fullnames[idx]
  if (!fullname) { printErr(`no item at index ${idx}`); return }
  await reddit.vote(fullname, dir)
  printOk(`${dir > 0 ? 'upvoted' : 'downvoted'} [${idx}]`)
}

// ---------------------------------------------------------------------------
// Command: post comment / post reply
// ---------------------------------------------------------------------------

async function cmdPost(args) {
  const [type, ...rest] = args

  if (type === 'comment') {
    if (!state.token) { printErr('not authenticated — type login first'); return }
    if (!state.parentName) { printErr('view a post first (view comments [index])'); return }
    const text = rest.join(' ')
    if (!text) { printErr('usage: post comment [text]'); return }

    const result = await reddit.submitComment(state.parentName, text)
    const things = result?.json?.data?.things || []
    if (state.parentPostText) print(state.parentPostText)
    for (const t of things) {
      if (t.kind === 't1') {
        const d = t.data
        print(chalk.bold('\nYour comment:\n') + md(d.body || '') + '\n')
      }
    }
    printOk('comment posted')
    return
  }

  if (type === 'reply') {
    if (!state.token) { printErr('not authenticated — type login first'); return }
    const [idxStr, ...textParts] = rest
    const idx = parseInt(idxStr)
    const text = textParts.join(' ')
    if (isNaN(idx) || !text) { printErr('usage: post reply [index] [text]'); return }
    const fullname = state.fullnames[idx]
    if (!fullname) { printErr(`no comment at index ${idx}`); return }

    const result = await reddit.submitComment(fullname, text)
    const things = result?.json?.data?.things || []
    for (const t of things) {
      if (t.kind === 't1') {
        print(chalk.bold('\nYour reply:\n') + md(t.data.body || '') + '\n')
      }
    }
    printOk('reply posted')
    return
  }

  printErr('usage: post comment [text] | post reply [index] [text]')
}

// ---------------------------------------------------------------------------
// Command: login
// ---------------------------------------------------------------------------

async function cmdLogin() {
  let clientId = state.clientId
  if (!clientId) {
    const cfg = await auth.loadConfig()
    clientId = cfg.clientId
  }

  if (!clientId) {
    print(chalk.bold('\nTo use authenticated features you need a Reddit app client ID.'))
    print('1. Go to ' + chalk.underline('https://www.reddit.com/prefs/apps'))
    print('2. Click "create app" → choose "installed app"')
    print('3. Set redirect URI to: ' + chalk.yellow('http://localhost:7474/callback'))
    print('4. Copy the client ID (string under the app name)\n')

    clientId = await new Promise(resolve => {
      rl.question(chalk.bold('Enter your Reddit client ID: '), resolve)
    })
    clientId = clientId.trim()
    if (!clientId) { printErr('no client ID provided'); return }
  }

  print('')
  state.token = await auth.login(clientId)
  state.clientId = clientId

  const me = await reddit.getMe()
  state.authUser = me.name
  const time = timeAgo(me.created_utc)
  printOk(chalk.bold(`logged in as ${chalk.cyan(me.name)}`))
  print(`  link karma: ${chalk.yellow(me.link_karma)}  comment karma: ${chalk.yellow(me.comment_karma)}  account: ${time}`)
  setPrompt()
}

// ---------------------------------------------------------------------------
// Command: logout
// ---------------------------------------------------------------------------

function cmdLogout() {
  state.token = null
  state.authUser = 'guest'
  state.clientId = null
  setPrompt()
  printOk('logged out')
}

// ---------------------------------------------------------------------------
// Command: settings
// ---------------------------------------------------------------------------

function cmdSettings(args) {
  const [a0, a1] = args

  if (!a0 || a0 === 'images' && !a1) {
    print(`images: ${chalk.bold(state.showImages ? 'on' : 'off')}  limit: ${chalk.bold(state.limit)}`)
    return
  }

  if (a0 === 'images' || a0 === 'img') {
    if (a1 === 'on') { state.showImages = true; printOk('images on') }
    else if (a1 === 'off') { state.showImages = false; printOk('images off') }
    else print(`images: ${chalk.bold(state.showImages ? 'on' : 'off')}`)
    return
  }

  if (a0 === 'limit') {
    if (!a1) { print(`limit: ${chalk.bold(state.limit)}`); return }
    if (a1 === 'auto') { state.limit = 25; printOk('limit set to auto (25)') }
    else {
      const n = parseInt(a1)
      if (isNaN(n) || n < 1 || n > 100) { printErr('limit must be 1–100 or auto'); return }
      state.limit = n
      printOk(`limit set to ${n}`)
    }
    return
  }

  printErr('usage: settings images [on|off] | settings limit [auto|1-100]')
}

// ---------------------------------------------------------------------------
// Help / about
// ---------------------------------------------------------------------------

function cmdHelp() {
  print(`
${chalk.bold('reddit shell')} — browse reddit from your terminal

${chalk.bold('Navigation')}
  ${chalk.yellow('list')}                         frontpage posts
  ${chalk.yellow('list [subreddit]')}             posts from a subreddit
  ${chalk.yellow('list [subreddit] [sort]')}      sort: new rising top controversial
  ${chalk.yellow('list subreddits')}              browse all subreddits
  ${chalk.yellow('list next')} / ${chalk.yellow('list previous')}     paginate
  ${chalk.yellow('cd ..')} / ${chalk.yellow('cd -')}                  go back
  ${chalk.yellow('ls')} / ${chalk.yellow('cd [subreddit]')}           aliases for list

${chalk.bold('Content')}
  ${chalk.yellow('view comments [index]')}        open comment thread
  ${chalk.yellow('view comments [index] [sort]')} sort: confidence top new hot qa
  ${chalk.yellow('view more comments')}           load hidden comments
  ${chalk.yellow('view more comments [index]')}   drill into a comment's replies
  ${chalk.yellow('view content [index]')}         open post URL in browser
  ${chalk.yellow('watch [subreddit]')}            stream new posts live (15s poll)
  ${chalk.yellow('search [term]')}                search reddit
  ${chalk.yellow('user [username]')}              view a user's posts and comments

${chalk.bold('Interaction')}  ${chalk.dim('(requires login)')}
  ${chalk.yellow('upvote [index]')}               upvote a post or comment
  ${chalk.yellow('downvote [index]')}             downvote a post or comment
  ${chalk.yellow('post comment [text]')}          comment on the current post
  ${chalk.yellow('post reply [index] [text]')}    reply to a comment

${chalk.bold('Auth & settings')}
  ${chalk.yellow('login')}                        authenticate with Reddit (OAuth2)
  ${chalk.yellow('logout')}                       clear your session
  ${chalk.yellow('settings images [on|off]')}     toggle inline image URLs
  ${chalk.yellow('settings limit [auto|1-100]')}  results per page

${chalk.bold('Misc')}
  ${chalk.yellow('pwd')}  ${chalk.yellow('clear')}  ${chalk.yellow('about')}  ${chalk.yellow('help')}
`)
}

function cmdAbout() {
  print(`
${chalk.bold('reddit shell')} v2.0.0 — CLI edition
${chalk.dim('Originally a browser-based terminal by Jason Botello (jasonb.io)')}
${chalk.dim('CLI port: Node.js 18+, chalk, marked, marked-terminal')}

${chalk.dim('Source: https://github.com/jasonbio/reddit-shell')}
`)
}

// ---------------------------------------------------------------------------
// Command normalisation + dispatch
// ---------------------------------------------------------------------------

const EASTER_EGG_PATTERNS = [
  'rm -rf', ':(){: | :&}', '{:(){ :|: & };:', 'mkfs.ext4', 'dd if=/dev/random',
  'mv ~ /dev/null', 'sudo make me a sandwich', 'sudo rm',
]

function parseCommand(raw) {
  let cmd = raw.trim()
    .replace(/\[|]/g, '')
    .replace(/^cd (\/?r?\/?)/, 'list ')
    .replace(/^cd ~\/?$/, 'list')
    .replace(/^ls$/, 'list')
    .replace(/^ls /, 'list ')

  const parts = cmd.split(/\s+/).filter(Boolean)
  if (!parts.length) return []

  // alias normalisation (first token)
  if (parts[0] === 'ls')    parts[0] = 'list'
  if (parts[0] === 'cd')    parts[0] = 'list'
  if (parts[0] === 'set')   parts[0] = 'settings'
  if (parts[0] === 'load')  parts[0] = 'view'
  if (parts[0] === 'subs')  { parts[0] = 'list'; parts.splice(1, 0, 'subreddits') }
  if (parts[0] === 'cat' && parts[1] === 'readme') { return ['help'] }
  if (parts[0] === 'readme') { return ['help'] }

  // alias normalisation (subsequent tokens)
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] === 'prev') parts[i] = 'previous'
    if (parts[i] === 'subs' && i === 1) parts[i] = 'subreddits'
  }

  return parts
}

async function handleCommand(raw) {
  if (!raw.trim()) return

  // Reddit's API requires OAuth even for public reads — prompt if not logged in
  const readCmds = ['list', 'ls', 'view', 'watch', 'search', 'user']
  const firstWord = raw.trim().split(/\s+/)[0]?.toLowerCase()
  if (readCmds.includes(firstWord) && !state.token) {
    print(chalk.yellow('Reddit requires authentication for API access.'))
    print(chalk.dim('Type ') + chalk.yellow('login') + chalk.dim(' to connect your Reddit account, then try again.\n'))
    return
  }

  // stop watch on any input
  if (state.watchInterval) {
    clearInterval(state.watchInterval)
    state.watchInterval = null
    print(chalk.dim('stopped watching'))
  }

  // cd .. / cd -
  if (raw === 'cd ..' || raw === 'cd -') {
    if (state.cmdStack.length > 0) {
      const prev = state.cmdStack.pop()
      await handleCommand(prev.join(' '))
    } else {
      await handleCommand('list')
    }
    return
  }

  // easter eggs
  if (EASTER_EGG_PATTERNS.some(p => raw.includes(p))) {
    print(chalk.red('(╯°□°）╯︵ ┻━┻  nice try'))
    return
  }

  const parts = parseCommand(raw)
  if (!parts.length) return
  const [cmd, ...args] = parts

  try {
    switch (cmd) {
      case 'list':     await cmdList(args);        break
      case 'view':     await cmdView(args);        break
      case 'watch':    await cmdWatch(args);       break
      case 'search':   await cmdSearch(args);      break
      case 'user':     await cmdUser(args);        break
      case 'upvote':   await cmdVote(args, 1);     break
      case 'downvote': await cmdVote(args, -1);    break
      case 'post':     await cmdPost(args);        break
      case 'login':    await cmdLogin();            break
      case 'logout':   cmdLogout();                 break
      case 'settings': cmdSettings(args);           break
      case 'pwd':      print(state.pwd);            break
      case 'clear':    process.stdout.write('\x1Bc'); break
      case 'help':     cmdHelp();                   break
      case 'about':    cmdAbout();                  break
      default:
        print(chalk.dim(`command not recognized — type ${chalk.yellow('help')} for usage`))
    }
  } catch (e) {
    printErr(e.message)
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  // try to restore saved session
  const cfg = await auth.loadConfig()
  if (cfg.token) {
    state.token = cfg.token
    state.clientId = cfg.clientId
    try {
      const me = await reddit.getMe()
      state.authUser = me.name
      print(chalk.dim(`restored session as ${chalk.cyan(me.name)}`))
    } catch {
      state.token = null
      state.authUser = 'guest'
    }
  }

  print(chalk.bold('\nreddit shell') + chalk.dim(' — type ') + chalk.yellow('help') + chalk.dim(' for usage\n'))
  setPrompt()
  rl.prompt()

  let commandPromise = Promise.resolve()
  let busy = false

  rl.on('line', async (line) => {
    if (busy) return
    busy = true
    commandPromise = (async () => {
      try {
        await handleCommand(line.trim())
      } finally {
        busy = false
        setPrompt()
        try { rl.prompt() } catch { /* readline already closed */ }
      }
    })()
  })

  rl.on('close', async () => {
    await commandPromise
    if (state.watchInterval) clearInterval(state.watchInterval)
    print(chalk.dim('\ngoodbye'))
    process.exit(0)
  })
}

init()
