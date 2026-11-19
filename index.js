// dsh-github-search —— Host 半片
//
// 职责：
//   1. 在 Web 服务上挂 /dsh-github-search/* 三个只读接口，替浏览器代理
//      api.github.com。这样做有两个必要理由：浏览器直连 api.github.com 的
//      响应头虽然允许跨域，但 Search 接口的限流信息与 token 都只能由服务端
//      掌握；代理后配额、错误与「要不要配 token」都能一并回报给界面。
//   2. 把同样的两个操作注册成 agent 工具（github_search / github_repo），
//      界面和工具走同一套逻辑，不各写一份。
//
// token 解析顺序（每次请求都重新解析，改了立即生效）：
//   1. cordis.patch.yml 里本行的 config.token
//   2. 本机 gh CLI 的登录凭据（~/.config/gh/hosts.yml）；config.useGhToken=false 可关
//   3. 环境变量 GITHUB_TOKEN / GH_TOKEN
// 未配置 token 时，GitHub 的搜索接口每个 IP 每分钟只有 10 次。

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { getRepo, getStatus, searchRepos } from './lib/github.js'

export const name = 'dsh-github-search'
export const inject = ['webServer', 'connection']

const ROUTE = '/dsh-github-search'
const PLUGIN = 'dsh-github-search'

/* ------------------------------------------------------------------ token */

const cache = { ghToken: undefined, readAt: 0 }
const GH_CACHE_MS = 60_000

async function ghCliToken() {
  const now = Date.now()
  if (cache.ghToken !== undefined && now - cache.readAt < GH_CACHE_MS) return cache.ghToken
  cache.readAt = now
  cache.ghToken = null
  try {
    const text = await readFile(join(homedir(), '.config', 'gh', 'hosts.yml'), 'utf8')
    const match = /oauth_token:\s*(\S+)/.exec(text)
    cache.ghToken = match ? match[1].trim() : null
  } catch {
    /* 没装 gh 或没登录都不算错误，安静回落到环境变量。 */
  }
  return cache.ghToken
}

/**
 * 解析本次调用要用的 token。
 * @returns {Promise<{ token?: string, source: 'config'|'gh-cli'|'env'|'none' }>}
 */
async function resolveToken(config) {
  const configured = typeof config?.token === 'string' ? config.token.trim() : ''
  if (configured) return { token: configured, source: 'config' }
  if (config?.useGhToken !== false) {
    const fromGh = await ghCliToken()
    if (fromGh) return { token: fromGh, source: 'gh-cli' }
  }
  const fromEnv = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim()
  if (fromEnv) return { token: fromEnv, source: 'env' }
  return { source: 'none' }
}

/* ------------------------------------------------------------------ 翻译 */

/** README 常常上万字符，翻译前先截断，避免把整篇都喂给模型。 */
const TRANSLATE_CHAR_LIMIT = 8000

const TRANSLATE_SYSTEM_PROMPT = [
  'You translate README documents into the target language.',
  'Preserve the Markdown structure exactly: headings, lists, tables, code fences, links, badges and HTML.',
  'Translate prose and comments; keep code, commands, identifiers, URLs, file paths and product names unchanged.',
  'Output only the translated Markdown, with no preface, notes or explanation.',
].join(' ')

/**
 * 把 README 翻成目标语言。
 *
 * 两条通道，按可靠性排序：
 *   1. Harness 的 translator 服务（部分 profile 不挂载）
 *   2. ctx.llm —— 直接调用户已配置的模型，凭据现成，且本 profile 一定有
 *
 * 两条都不可用时明确报错，而不是假装翻译成功。
 * @returns {Promise<{ text: string, truncated: boolean, via: string }>}
 */
async function translateReadme(ctx, input, signal) {
  const text = typeof input?.text === 'string' ? input.text : ''
  const target = typeof input?.target === 'string' && input.target ? input.target : 'zh-CN'
  if (!text.trim()) throw Object.assign(new Error('没有可翻译的 README'), { status: 400, code: 'empty-text' })

  // 太长就截断，并把截断事实回报给界面 —— 不声不响只翻一半会误导用户。
  const truncated = text.length > TRANSLATE_CHAR_LIMIT
  const body = truncated ? text.slice(0, TRANSLATE_CHAR_LIMIT) : text

  const translator = ctx.get('translator')
  if (typeof translator?.resolve === 'function' && typeof translator.translate === 'function') {
    try {
      const spec = translator.resolve({ text: body, targetLanguage: target })
      const out = await translator.translate(spec, signal)
      const result = typeof out === 'string' ? out : String(out ?? '')
      if (result.trim()) return { text: result, truncated, via: `translator:${spec?.provider ?? 'unknown'}` }
    } catch {
      // translator 失败就安静退到 llm，不把两条通道的错都抛给用户。
    }
  }

  const result = await translateViaLlm(ctx, body, target, signal)
  return { text: result.text, truncated, via: `llm:${result.provider}/${result.model}` }
}

/** 用 ctx.llm 调当前配置的模型翻译。这是本 profile 一定可用的通道。 */
async function translateViaLlm(ctx, body, target, signal) {
  const llm = ctx.get('llm')
  if (typeof llm?.stream !== 'function') {
    throw Object.assign(
      new Error('这个 DSH 没有可用的翻译通道（既没有翻译服务，也没有模型路由）'),
      { status: 501, code: 'translate-unavailable' },
    )
  }

  const selection = await resolveModelSelection(ctx)
  if (!selection) {
    throw Object.assign(
      new Error('没有已配置的模型可以用来翻译'),
      { status: 501, code: 'no-model' },
    )
  }

  const chunks = llm.stream({
    provider: selection.provider,
    model: selection.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
    system: `${TRANSLATE_SYSTEM_PROMPT} Target language: ${target}.`,
    temperature: 0.2,
    signal,
  })

  let out = ''
  for await (const chunk of chunks) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
    else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw Object.assign(
        new Error(chunk.reason.failure?.message || '模型翻译失败'),
        { status: 502, code: 'translate-failed' },
      )
    }
  }
  if (!out.trim()) {
    throw Object.assign(new Error('模型没有返回译文'), { status: 502, code: 'empty-result' })
  }
  return { text: out, provider: selection.provider, model: selection.model }
}

/**
 * 取一个可用于翻译的模型路由。
 *
 * 优先用 agentDefaultModel 的当前选择（用户正在用的那个）。拿不到时退回到
 * 任一已注册 provider，并向它要一个具体模型 —— 空 model 传进 stream 会失败，
 * 所以这一步必须问出真名字。
 */
async function resolveModelSelection(ctx) {
  const pick = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (pick?.provider && pick?.model) return { provider: pick.provider, model: pick.model }

  const llm = ctx.get('llm')
  const providers = llm?.listProviders?.() ?? []
  for (const provider of providers) {
    if (!provider?.id) continue
    try {
      const models = await llm.listModels(provider.id)
      const first = models?.find((one) => one?.id)
      if (first) return { provider: provider.id, model: first.id }
    } catch {
      // 这个 provider 列不出模型就试下一个。
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ HTTP */

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('请求体太大'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('请求不是有效的 JSON'), { status: 400 })
  }
}

/**
 * Web 服务不替插件路由鉴权：每个请求自己过一遍 Host/Origin 与登录凭证检查。
 * 拿不到鉴权服务时一律拒绝。
 */
function rejectUnauthorized(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

/* ------------------------------------------------------------------ 路由 */

/**
 * @param config - 本行的 config（cordis.patch.yml 里可覆盖）
 * @param operation - 'search' | 'repo' | 'status'
 */
async function runOperation(config, operation, input, signal) {
  const auth = await resolveToken(config)
  const options = { token: auth.token, signal }
  if (operation === 'search') {
    const result = await searchRepos(input, options)
    return { ...result, tokenSource: auth.source }
  }
  if (operation === 'repo') {
    const result = await getRepo(input, options)
    return { ...result, tokenSource: auth.source }
  }
  const status = await getStatus(options)
  return { ...status, tokenSource: auth.source }
}

async function route(ctx, config, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.slice(ROUTE.length) || '/'
  const params = url.searchParams
  const signal = AbortSignal.timeout(20_000)

  if (path === '/status' && req.method === 'GET') {
    try {
      const status = await runOperation(config, 'status', {}, signal)
      json(res, 200, status)
    } catch (error) {
      // 配额查询失败不该让界面整页报错：降级成「未知配额」。
      json(res, 200, { authenticated: false, tokenSource: 'unknown', rate: {}, error: message(error) })
    }
    return
  }

  if (path === '/search' && (req.method === 'GET' || req.method === 'POST')) {
    const input = req.method === 'POST'
      ? await readJson(req)
      : {
          query: params.get('q') ?? '',
          sort: params.get('sort') ?? undefined,
          order: params.get('order') ?? undefined,
          page: numberParam(params.get('page')),
          limit: numberParam(params.get('limit')),
          language: params.get('language') ?? undefined,
          topic: params.get('topic') ?? undefined,
          owner: params.get('owner') ?? undefined,
          minStars: numberParam(params.get('minStars')),
          license: params.get('license') ?? undefined,
          inName: params.get('inName') === '1',
          includeArchived: params.get('includeArchived') === '1',
        }
    json(res, 200, await runOperation(config, 'search', input, signal))
    return
  }

  if (path === '/translate' && req.method === 'POST') {
    const input = await readJson(req, 256 * 1024)
    // 翻译可能比搜索慢，给更长的时限。
    json(res, 200, await translateReadme(ctx, input, AbortSignal.timeout(60_000)))
    return
  }

  if (path === '/repo' && (req.method === 'GET' || req.method === 'POST')) {
    const input = req.method === 'POST'
      ? await readJson(req)
      : { repo: params.get('repo') ?? '' }
    json(res, 200, await runOperation(config, 'repo', input, signal))
    return
  }

  json(res, 404, { error: '没有这个接口' })
}

function numberParam(raw) {
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function message(error) {
  return String(error?.message ?? error)
}

/* ------------------------------------------------------------------ 工具 */

/** 工具返回统一是 `{ text }`，渲染成一个纯文本块。 */
const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
}

function formatCount(value) {
  const n = Number(value) || 0
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** 搜索结果 → 给模型读的紧凑列表，一行一个仓库。 */
function renderSearch(result) {
  // 只展示用户输入的词，不去报内部拼上的限定符（archived:false 之类）。
  const lines = [
    `关键词：${result.keywords ?? result.query}　排序：${result.sort}${result.sort === 'best-match' ? '' : `（${result.order}）`}　命中约 ${result.total} 个仓库，本页 ${result.items.length} 个`,
  ]
  if (result.incomplete) lines.push('（GitHub 标记本次结果不完整，可能还有更多匹配）')
  if (!result.items.length) {
    lines.push('没有匹配的仓库，换个关键词或放宽筛选条件。')
    return lines.join('\n')
  }
  lines.push('')
  result.items.forEach((item, index) => {
    const flags = [item.archived ? '已归档' : '', item.isFork ? 'fork' : ''].filter(Boolean)
    const head = `${index + 1}. ${item.fullName}　★${formatCount(item.stars)}　⑂${formatCount(item.forks)}${item.language ? `　${item.language}` : ''}${flags.length ? `　[${flags.join(' ')}]` : ''}`
    lines.push(head)
    if (item.description) lines.push(`   ${item.description}`)
    lines.push(`   ${item.url}　更新于 ${item.updatedAt.slice(0, 10)}`)
    if (item.topics.length) lines.push(`   topics: ${item.topics.join(', ')}`)
  })
  if (result.rate?.remaining !== undefined) {
    lines.push('', `（本次剩余配额 ${result.rate.remaining}${result.tokenSource === 'none' ? '，未配置 token 时每分钟只有 10 次搜索' : ''}）`)
  }
  return lines.join('\n')
}

function renderRepo(repo) {
  const lines = [
    `# ${repo.fullName}`,
    repo.description || '（没有简介）',
    '',
    `★ ${repo.stars}　⑂ ${repo.forks}　issues ${repo.openIssues}　${repo.language || '未知语言'}${repo.license ? `　${repo.license}` : ''}　默认分支 ${repo.defaultBranch}`,
    `最近更新 ${repo.updatedAt.slice(0, 10)}　创建于 ${repo.createdAt.slice(0, 10)}${repo.archived ? '　（已归档）' : ''}`,
    `仓库 ${repo.url}`,
    `克隆 ${repo.cloneUrl}`,
  ]
  if (repo.homepage) lines.push(`主页 ${repo.homepage}`)
  if (repo.topics.length) lines.push(`topics: ${repo.topics.join(', ')}`)
  if (repo.languages.length) {
    lines.push('', `语言构成：${repo.languages.map((one) => `${one.name} ${one.percent}%`).join('　')}`)
  }
  if (repo.readme) {
    lines.push('', '--- README ---', repo.readme.slice(0, 6000))
  } else {
    lines.push('', '（这个仓库没有 README）')
  }
  return lines.join('\n')
}

function registerTools(ctx, config) {
  const tools = ctx.get('tools')
  if (typeof tools?.register !== 'function') return

  ctx.effect(
    () =>
      tools.register({
        name: 'github_search',
        description:
          'Search GitHub repositories and list matching projects with stars, language, description and URL. Use it to find libraries, tools or projects on GitHub without the user opening github.com. Returns a compact ranked list; follow up with github_repo for one repository\'s README and details.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Keywords or search terms, e.g. "vector database" or "rust http client".' },
            language: { type: 'string', description: 'Restrict to one main language, e.g. TypeScript.' },
            topic: { type: 'string', description: 'Restrict to GitHub topics, comma separated, e.g. "llm,rag".' },
            owner: { type: 'string', description: 'Restrict to one user or organization login.' },
            minStars: { type: 'integer', description: 'Only repositories with at least this many stars.' },
            license: { type: 'string', description: 'SPDX license id, e.g. MIT or Apache-2.0.' },
            sort: { type: 'string', enum: ['best-match', 'stars', 'forks', 'updated'], description: 'Result ordering; defaults to best-match.' },
            order: { type: 'string', enum: ['desc', 'asc'], description: 'Order direction for stars, forks or updated; defaults to desc.' },
            page: { type: 'integer', description: '1-based page number, at most 10.' },
            limit: { type: 'integer', description: 'Repositories per page, 1-50; defaults to 20.' },
            inName: { type: 'boolean', description: 'Match the keywords against repository names only.' },
            includeArchived: { type: 'boolean', description: 'Include archived repositories; defaults to excluding them.' },
          },
          required: ['query'],
        },
        output: TEXT_OUTPUT,
        isConcurrencySafe: () => true,
        async execute(args) {
          const input = { ...args, sort: args.sort === 'best-match' ? undefined : args.sort }
          const result = await runOperation(config, 'search', input, AbortSignal.timeout(20_000))
          return { text: renderSearch(result) }
        },
      }),
    `${PLUGIN}: github_search`,
  )

  ctx.effect(
    () =>
      tools.register({
        name: 'github_repo',
        description:
          'Read one GitHub repository by owner/repo or URL: description, stars, language breakdown, clone URL and README. Use it after github_search to evaluate one candidate in depth.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            repo: { type: 'string', description: 'Repository as owner/repo, or a github.com URL.' },
          },
          required: ['repo'],
        },
        output: TEXT_OUTPUT,
        isConcurrencySafe: () => true,
        async execute(args) {
          const result = await runOperation(config, 'repo', args, AbortSignal.timeout(20_000))
          return { text: renderRepo(result) }
        },
      }),
    `${PLUGIN}: github_repo`,
  )
}

/* ------------------------------------------------------------------ 翻译工具 */

function renderTranslation(result) {
  const head = result.truncated
    ? '（README 较长，只翻了前 8000 字符）'
    : ''
  return [head, result.text].filter(Boolean).join('\n')
}

function registerTranslateTool(ctx, config) {
  const tools = ctx.get('tools')
  if (typeof tools?.register !== 'function') return

  ctx.effect(
    () =>
      tools.register({
        name: 'github_translate_readme',
        description:
          'Translate one GitHub repository README into another language (Chinese by default) and return the translated plain text. Use it when a repository has only an English README and the user asks what it says. Pass repo to fetch and translate that repository\'s README, or text to translate README content you already have. Read-only; the translation service may be unavailable in some profiles, which the tool reports explicitly.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            repo: { type: 'string', description: 'Repository as owner/repo or a github.com URL; its README is fetched first.' },
            text: { type: 'string', description: 'README text to translate directly, when it was already fetched.' },
            target: { type: 'string', description: 'Target language tag, e.g. zh-CN (default) or English.' },
          },
        },
        output: TEXT_OUTPUT,
        isConcurrencySafe: () => true,
        async execute(args) {
          const signal = AbortSignal.timeout(60_000)
          let source = typeof args.text === 'string' ? args.text : ''
          if (!source.trim()) {
            const repo = await runOperation(config, 'repo', { repo: args.repo }, signal)
            source = typeof repo.readme === 'string' ? repo.readme : ''
          }
          if (!source.trim()) return { text: '这个仓库没有 README，无法翻译。' }
          const out = await translateReadme(ctx, { text: source, target: args.target }, signal)
          return { text: renderTranslation(out) }
        },
      }),
    `${PLUGIN}: github_translate_readme`,
  )
}

/* ------------------------------------------------------------------ 入口 */

export function apply(ctx, config = {}) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            const rejection = rejectUnauthorized(ctx, req)
            if (rejection !== undefined) {
              json(res, rejection, { error: '未授权' })
              return
            }
            await route(ctx, config, req, res)
          } catch (error) {
            if (res.headersSent) {
              res.end()
              return
            }
            json(res, error?.status ?? 500, { error: message(error), code: error?.code })
          }
        },
      }),
    `${PLUGIN}: routes`,
  )

  registerTools(ctx, config)
  registerTranslateTool(ctx, config)
}
