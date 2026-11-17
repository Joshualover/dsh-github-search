// dsh-github-search —— GitHub 仓库检索核心
//
// 只读地调用 GitHub REST API（/search/repositories、/repos/{owner}/{repo}，
// 以及 README 与语言统计），把结果裁剪成插件与工具都用得上的一份瘦身结构。
// 这一层不关心 HTTP 路由、鉴权或渲染，方便 Host 路由和 agent 工具共用同一套逻辑。

const API_BASE = 'https://api.github.com'
const USER_AGENT = 'dsh-github-search/1.0'
const DEFAULT_TIMEOUT_MS = 15000

/** GitHub 的 sort 取值是固定的四个，其余一律回落到最佳匹配。 */
const SORTS = new Set(['stars', 'forks', 'updated'])

/** 搜索词里由参数拼出来的限定符，避免用户手写时与我们重复。 */
function qualifiers(input) {
  const parts = []
  if (input.language) parts.push(`language:${quote(input.language)}`)
  if (input.topic) for (const topic of splitList(input.topic)) parts.push(`topic:${quote(topic)}`)
  if (input.owner) parts.push(`user:${quote(input.owner)}`)
  if (input.license) parts.push(`license:${quote(input.license)}`)
  if (Number.isFinite(input.minStars) && input.minStars > 0) parts.push(`stars:>=${Math.floor(input.minStars)}`)
  if (Number.isFinite(input.maxStars) && input.maxStars > 0) parts.push(`stars:<=${Math.floor(input.maxStars)}`)
  if (input.pushedAfter) parts.push(`pushed:>=${input.pushedAfter}`)
  if (input.createdAfter) parts.push(`created:>=${input.createdAfter}`)
  if (input.inName === true) parts.push('in:name')
  if (input.includeArchived !== true) parts.push('archived:false')
  return parts
}

/** 带空格的限定符值要加引号，否则 GitHub 会把它当成多个词。 */
function quote(value) {
  const text = String(value).trim()
  return /\s/.test(text) ? `"${text.replace(/"/g, '')}"` : text
}

function splitList(value) {
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 把参数拼成 GitHub 搜索语法。
 * @returns {{ query: string, keywords: string, sort: string, order: 'asc'|'desc', page: number, perPage: number }}
 */
export function buildSearchParams(input = {}) {
  const keywords = String(input.query ?? '').trim()
  const query = [keywords, ...qualifiers(input)].filter(Boolean).join(' ').trim()
  const perPage = clamp(Math.trunc(input.limit ?? 20), 1, 50)
  return {
    query,
    keywords,
    sort: SORTS.has(input.sort) ? input.sort : '',
    order: input.order === 'asc' ? 'asc' : 'desc',
    page: clamp(Math.trunc(input.page ?? 1), 1, 10),
    perPage,
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/* ------------------------------------------------------------------ HTTP */

/**
 * 一次 GitHub API 调用的最小封装：统一请求头、超时、错误与限流信息。
 * `raw: true` 时不解析 JSON，直接把响应体当作字符串返回（README 用得上）。
 * @returns {Promise<{ data: unknown, rate: RateInfo }>}
 */
async function request(path, { token, signal, accept = 'application/vnd.github+json', raw = false } = {}) {
  const headers = {
    accept,
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  }
  if (token) headers.authorization = `Bearer ${token}`

  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response
  try {
    response = await fetch(`${API_BASE}${path}`, { headers, signal: composed })
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? '请求 GitHub 超时' : String(error?.message ?? error)
    throw fail(502, reason, 'network')
  }

  const rate = readRate(response.headers)
  const text = await response.text()

  if (!response.ok) {
    let detail = ''
    try {
      const body = JSON.parse(text)
      detail = typeof body?.message === 'string' ? body.message : ''
    } catch {
      /* 非 JSON 错误体（例如网关页面）不额外处理。 */
    }
    if (response.status === 403 || response.status === 429) {
      if (rate.remaining === 0) {
        const when = rate.resetAt ? new Date(rate.resetAt * 1000).toLocaleString() : '稍后'
        const hint = rate.limit > 0 && rate.limit <= 10 && !token
          ? '（未配置 token 时搜索接口每个 IP 每分钟只有 10 次，配一个 token 会宽松很多）'
          : ''
        throw fail(429, `GitHub 搜索配额用完了，${when} 后恢复${hint}`, 'rate-limit')
      }
      throw fail(403, detail || 'GitHub 拒绝了这次请求', 'forbidden')
    }
    if (response.status === 404) throw fail(404, detail || '仓库不存在或没有权限访问', 'not-found')
    if (response.status === 422) throw fail(422, detail || '搜索条件不合法，换个关键词或放宽筛选', 'invalid-query')
    throw fail(502, detail || `GitHub 返回 HTTP ${response.status}`, 'upstream')
  }

  let data
  if (raw) {
    data = text
  } else {
    try {
      data = JSON.parse(text)
    } catch {
      throw fail(502, 'GitHub 返回了无法解析的内容', 'bad-payload')
    }
  }
  return { data, rate }
}

function readRate(headers) {
  const num = (name) => {
    const raw = headers.get(name)
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  return {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    resetAt: num('x-ratelimit-reset'),
    resource: headers.get('x-ratelimit-resource') ?? undefined,
  }
}

/** 带 HTTP 状态码的错误，路由层据此决定响应码。 */
function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code })
}

/* ------------------------------------------------------------------ 映射 */

/** 仓库对象瘦身：只留列表与详情真正会展示的字段。 */
export function toRepoSummary(item) {
  if (!item || typeof item !== 'object') return null
  const fullName = typeof item.full_name === 'string' ? item.full_name : ''
  if (!fullName) return null
  return {
    fullName,
    name: item.name ?? fullName.split('/').pop(),
    owner: item.owner?.login ?? fullName.split('/')[0],
    ownerAvatar: item.owner?.avatar_url ?? '',
    description: item.description ?? '',
    url: item.html_url ?? `https://github.com/${fullName}`,
    homepage: item.homepage ?? '',
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    openIssues: item.open_issues_count ?? 0,
    language: item.language ?? '',
    license: item.license?.spdx_id ?? item.license?.name ?? '',
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 12) : [],
    updatedAt: item.updated_at ?? '',
    pushedAt: item.pushed_at ?? '',
    createdAt: item.created_at ?? '',
    archived: item.archived === true,
    isFork: item.fork === true,
    defaultBranch: item.default_branch ?? 'main',
    cloneUrl: item.clone_url ?? `https://github.com/${fullName}.git`,
    size: item.size ?? 0,
  }
}

/* ------------------------------------------------------------------ 操作 */

/**
 * 搜索仓库。
 * @returns {Promise<{ items: object[], total: number, incomplete: boolean, query: string, rate: object }>}
 */
export async function searchRepos(input = {}, options = {}) {
  const params = buildSearchParams(input)
  // 必须校验原始关键词：只靠限定符（如 archived:false）拼出的查询串同样非空，
  // 那会把整个 GitHub 都搜一遍，等于用户什么都没输却拿到一堆结果。
  if (!params.keywords) throw fail(400, '请先输入要搜索的关键词', 'empty-query')
  const search = new URLSearchParams({
    q: params.query,
    per_page: String(params.perPage),
    page: String(params.page),
  })
  if (params.sort) {
    search.set('sort', params.sort)
    search.set('order', params.order)
  }
  const { data, rate } = await request(`/search/repositories?${search}`, options)
  const items = Array.isArray(data?.items) ? data.items.map(toRepoSummary).filter(Boolean) : []
  return {
    query: params.query,
    keywords: params.keywords,
    sort: params.sort || 'best-match',
    order: params.order,
    page: params.page,
    total: Number(data?.total_count ?? items.length),
    incomplete: data?.incomplete_results === true,
    items,
    rate,
  }
}

/** 精确到某个仓库的完整信息，附带 README 文本与语言占比。 */
export async function getRepo(input = {}, options = {}) {
  const fullName = normalizeFullName(input.repo ?? input.fullName)
  if (!fullName) throw fail(400, '需要 owner/repo 形式的仓库名', 'bad-repo')
  const { data, rate } = await request(`/repos/${fullName}`, options)
  const summary = toRepoSummary(data)
  if (!summary) throw fail(502, 'GitHub 返回的仓库信息不完整', 'bad-payload')

  const [readme, languages] = await Promise.all([
    readReadme(fullName, options).catch(() => null),
    request(`/repos/${fullName}/languages`, options)
      .then((result) => result.data)
      .catch(() => null),
  ])

  return {
    ...summary,
    readme,
    languages: percentLanguages(languages),
    rate,
  }
}

async function readReadme(fullName, options) {
  const { data } = await request(`/repos/${fullName}/readme`, { ...options, accept: 'application/vnd.github.raw', raw: true })
  if (typeof data !== 'string' || data === '') return null
  const limit = 20000
  return data.length > limit ? `${data.slice(0, limit)}\n\n…（README 过长，已截断）` : data
}

function percentLanguages(languages) {
  if (!languages || typeof languages !== 'object') return []
  const entries = Object.entries(languages).filter(([, bytes]) => Number.isFinite(bytes) && bytes > 0)
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0)
  if (total <= 0) return []
  return entries
    .map(([name, bytes]) => ({ name, percent: Math.round((bytes / total) * 1000) / 10 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 6)
}

/** 容忍用户直接粘贴 https://github.com/a/b 或 a/b.git 这类写法。 */
export function normalizeFullName(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const fromUrl = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(text)
  const raw = fromUrl ? `${fromUrl[1]}/${fromUrl[2]}` : text
  const cleaned = raw.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  return /^[\w.-]+\/[\w.-]+$/.test(cleaned) ? cleaned : ''
}

/** 配额与 token 状态，客户端据此提示「要不要配 token」。 */
export async function getStatus(options = {}) {
  const { data, rate } = await request('/rate_limit', options)
  // /rate_limit 响应体里分资源列了各自的桶；搜索消耗的是 search 桶，
  // 未认证时只有每分钟 10 次，和响应头的 core 桶（60/小时）完全不是一回事。
  const search = data?.resources?.search
  const bucket = search && Number.isFinite(search.limit)
    ? { limit: search.limit, remaining: search.remaining, resetAt: search.reset }
    : rate
  return { rate: bucket, authenticated: Boolean(options.token) }
}
