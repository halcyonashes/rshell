import { state } from './state.js'

export const PUBLIC_BASE = 'https://www.reddit.com'
export const OAUTH_BASE = 'https://oauth.reddit.com'

// Reddit requires: <platform>:<app ID>:<version> (by /u/<username>)
// https://github.com/reddit-archive/reddit/wiki/API#rules
const UA = 'nodejs:rshell-cli:v2.0.0 (by /u/rshell-cli-user)'

async function apireq(url, opts = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json',
    ...opts.headers,
  }
  if (state.token) headers['Authorization'] = `bearer ${state.token}`

  const res = await fetch(url, { ...opts, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Reddit sometimes returns HTML for 403/429 — extract status only
    throw new Error(`HTTP ${res.status} from Reddit (${url.split('?')[0]})`)
  }
  return res.json()
}

// Returns the correct base URL for listing endpoints.
// Reddit now blocks unauthenticated server-side requests on www.reddit.com;
// oauth.reddit.com works for authenticated users (scope: read).
export function listingBase() {
  return state.token ? OAUTH_BASE : PUBLIC_BASE
}

export async function fetchListingUrl(url) {
  // Rewrite base to oauth when authenticated so paginated URLs also go through OAuth
  if (state.token && url.startsWith(PUBLIC_BASE)) {
    url = OAUTH_BASE + url.slice(PUBLIC_BASE.length)
  }
  return apireq(url)
}

export async function fetchListing(path, params = {}) {
  const qs = new URLSearchParams({ limit: state.limit, ...params }).toString()
  return apireq(`${listingBase()}${path}.json?${qs}`)
}

export async function fetchComments(postUrl, sort) {
  const params = sort ? `sort=${sort}&limit=${state.limit}` : `limit=${state.limit}`
  return apireq(`${postUrl}.json?${params}`)
}

export async function fetchMoreChildren(linkId, childIds) {
  const qs = new URLSearchParams({
    link_id: linkId,
    children: childIds.join(','),
    api_type: 'json',
  })
  return apireq(`${PUBLIC_BASE}/api/morechildren.json?${qs}`)
}

export async function vote(fullname, dir) {
  if (!state.token) throw new Error('not authenticated — type login first')
  const body = new URLSearchParams({ dir: String(dir), id: fullname })
  return apireq(`${OAUTH_BASE}/api/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

export async function submitComment(thingId, text) {
  if (!state.token) throw new Error('not authenticated — type login first')
  const body = new URLSearchParams({ api_type: 'json', thing_id: thingId, text })
  return apireq(`${OAUTH_BASE}/api/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

export async function getMe() {
  if (!state.token) throw new Error('not authenticated')
  return apireq(`${OAUTH_BASE}/api/v1/me.json`)
}

export async function exchangeCode(clientId, code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token exchange failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  return res.json()
}
