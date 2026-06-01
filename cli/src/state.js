export const state = {
  posts: [],       // full permalink URLs  e.g. https://www.reddit.com/r/sub/comments/id/title/
  comments: [],    // comment permalink URLs  e.g. posts[n] + commentId
  content: [],     // post destination URLs (for view content)
  fullnames: [],   // Reddit fullnames  t3_xxx / t1_xxx  (for voting)
  subreddits: [],  // subreddit display names (for autocomplete)
  stream: new Set(), // post IDs already shown in watch mode

  nextUrl: null,
  prevUrl: null,
  morelink: null,   // morechildren API URL when there are hidden comments
  jsonBase: '',     // base URL for building comment URLs = posts[n] (current post)
  parentName: '',   // fullname of current post (for top-level commenting)
  parentPostText: '', // rendered text of current post header (re-shown after post comment)

  pwd: '/',
  cmdStack: [],     // navigation history for cd ..

  token: null,
  authUser: 'guest',
  clientId: null,

  limit: 25,
  showImages: false,

  postCount: 0,
  commentCount: 0,
  subCount: 0,
  searchTerm: '',

  watchInterval: null,
}

export function resetListing() {
  state.posts = []
  state.comments = []
  state.content = []
  state.fullnames = []
  state.nextUrl = null
  state.prevUrl = null
  state.morelink = null
  state.jsonBase = ''
  state.parentName = ''
  state.parentPostText = ''
  state.postCount = 0
  state.commentCount = 0
  state.subCount = 0
}
