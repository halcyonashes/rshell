# rshell

rshell lets you browse and interact with Reddit via a command-line interface.

Available in two flavors:

- **Web app** — browser-based terminal emulator
- **CLI** — native Node.js terminal app (run locally, no browser needed)

---

## CLI

### Requirements

- Node.js 18+
- A Reddit account
- A Reddit API app (free, takes 2 minutes)

### Setup

```bash
cd cli
npm install
node bin/rshell
```

Or install globally:

```bash
cd cli
npm install -g .
rshell
```

### First-time authentication

Reddit requires OAuth even for reading public content. Before browsing, run `login`:

1. Go to [developers.reddit.com/app-registration](https://developers.reddit.com/app-registration)
2. Accept the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)
3. Create an app → choose **installed app** type
4. Set redirect URI to `http://localhost:7474/callback`
5. Copy the client ID (short string shown under the app name)
6. In rshell, type `login` and paste your client ID when prompted

Your token is saved to `~/.rshell/config.json` and restored automatically on next run.

---

## Commands

### Navigation

| Command | Description |
|---------|-------------|
| `list` | Frontpage posts |
| `list [subreddit]` | Posts from a subreddit |
| `list [subreddit] [sort]` | Sort: `new` `rising` `top` `controversial` |
| `list subreddits` | Browse all subreddits |
| `list next` / `list previous` | Paginate results |
| `ls` / `cd [subreddit]` | Aliases for list |
| `cd ..` / `cd -` | Go back to previous view |

### Content

| Command | Description |
|---------|-------------|
| `view comments [index]` | Open comment thread for a post |
| `view comments [index] [sort]` | Sort: `confidence` `top` `new` `hot` `qa` |
| `view more comments` | Load hidden comments |
| `view more comments [index]` | Drill into a comment's replies |
| `view content [index]` | Open post URL in your browser |
| `watch [subreddit]` | Stream new posts live (polls every 15s) |
| `search [term]` | Search Reddit |
| `search next` / `search previous` | Paginate search results |
| `user [username]` | View a user's posts and comments |
| `user [username] next` | Paginate user overview |

### Interaction *(requires login)*

| Command | Description |
|---------|-------------|
| `upvote [index]` | Upvote a post or comment |
| `downvote [index]` | Downvote a post or comment |
| `post comment [text]` | Comment on the current post |
| `post reply [index] [text]` | Reply to a specific comment |

### Auth & settings

| Command | Description |
|---------|-------------|
| `login` | Authenticate via Reddit OAuth2 |
| `logout` | Clear your session |
| `settings images [on\|off]` | Toggle inline image URLs |
| `settings limit [auto\|1-100]` | Results per page |

### Misc

`pwd`  `clear`  `about`  `help`

---

## Web app

The original browser-based version — no setup needed, open in any browser.

**Features**

- Browse subreddits, posts, comments, and users
- Nested comment trees with pagination
- Watch subreddits for new posts (live stream)
- Tab autocomplete for commands, subreddit names, and usernames
- Search posts and comments
- OAuth 2 login
- Upvote/downvote and comment/reply

**Libraries**

- [jQuery](https://jquery.com/)
- [jQuery Terminal](http://terminal.jcubic.pl/)
- [Showdown](https://github.com/showdownjs/showdown)
- [Moment.js](http://momentjs.com/)

---

## CLI libraries

- [chalk](https://github.com/chalk/chalk)
- [marked](https://marked.js.org/) + [marked-terminal](https://github.com/mikaelbr/marked-terminal)
- [open](https://github.com/sindresorhus/open)
