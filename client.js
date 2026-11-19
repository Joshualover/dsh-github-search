// dsh-github-search —— 浏览器半片
//
// 在左栏注册一个入口图标，主面板是一页 GitHub 项目搜索：
//   搜索框 → 结果列表（星标 / 语言 / 更新时间 / 简介 / topics）→ 点开看 README。
// 数据来自 Host 半片的 /dsh-github-search/*，浏览器不直连 api.github.com，
// 这样配额与 token 都由 Host 统一掌握。
//
// 只依赖宿主已提供的 react 与 react/jsx-runtime，不 import 任何 DSH 客户端包。

window.__ModuleLoader__.load({
  id: 'dsh-github-search',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const react = require('react')
    // 直接用 createElement：它接受第三参数作为 children，
    // 而 react/jsx-runtime 的 jsx(type, props) 只认 props.children，
    // 传第三个参数会被静默丢掉（页面变空白）。
    const h = react.createElement
    const fsx = react.createElement

    /* ------------------------------------------------------------ 常量 */

    const PLUGIN = 'dsh-github-search'
    const PANEL_ID = 'dsh-github-search'
    const API = 'dsh-github-search'

    // 文案在 t() 里取，常量只留 id 与字典 key。
    const SORTS = [
      { id: 'best-match', labelKey: 'sortBest' },
      { id: 'stars', labelKey: 'sortStars' },
      { id: 'forks', labelKey: 'sortForks' },
      { id: 'updated', labelKey: 'sortUpdated' },
    ]

    /** 常用语言：GitHub 的语言名必须精确，这里只放最常筛的几个。 */
    const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'C#', 'Swift', 'Kotlin', 'PHP', 'Ruby']

    const EXAMPLES = ['ai agent framework', 'local llm inference', 'rust terminal ui', 'text to speech']

    /** GitHub 搜索最多返回前 1000 条，每页 20 条，因此 10 页之后没有新内容可拿。 */
    const MAX_PAGE = 10
    const PAGE_SIZE = 20

    /** 搜索历史：存 10 条，界面上最多铺开 8 条。 */
    const HISTORY_KEY = 'dsh-github-search:history'
    const HISTORY_MAX = 10
    const HISTORY_SHOWN = 8

    /* ------------------------------------------------------------ 样式 */

    // 只用 --dsw-alias-* 主题 token，深浅色跟随宿主；不出现字面色值。
    const CSS = `
[data-github-search] {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
}
[data-github-search] .ghs-top {
  padding: 18px 24px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: none;
}
[data-github-search] .ghs-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
[data-github-search] .ghs-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
[data-github-search] .ghs-quota {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
[data-github-search] .ghs-quota-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
}
[data-github-search] .ghs-quota-dot.is-low { background: var(--dsw-alias-state-error-primary); }
[data-github-search] .ghs-quota-dot.is-off { background: var(--dsw-alias-state-idle-primary); }

[data-github-search] .ghs-search {
  display: flex;
  gap: 8px;
  /* 面板被拖窄时按钮不该被输入框压成一条缝：按钮保持内容宽度。 */
}
[data-github-search] .ghs-search > .ghs-btn { flex: none; }
[data-github-search] .ghs-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  outline: none;
}
[data-github-search] .ghs-input::placeholder { color: var(--dsw-alias-label-tertiary); }
[data-github-search] .ghs-input:focus {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px var(--dsw-alias-button-ghost-active-fill);
}
[data-github-search] .ghs-btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease;
}
[data-github-search] .ghs-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-github-search] .ghs-btn:disabled { opacity: 0.5; cursor: default; }
[data-github-search] .ghs-btn.is-primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  /* 不能配 brand-primary-invert：它与 button-primary-fill 解析成同一个颜色，
     文字会和底色一模一样（对比度 1:1）。label-primary-foreground 才是在
     主色底上的反白前景。 */
  color: var(--dsw-alias-label-primary-foreground);
}
[data-github-search] .ghs-btn.is-primary:hover { background: var(--dsw-alias-button-primary-hover); }

[data-github-search] .ghs-history {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 24px;
}
[data-github-search] .ghs-history-label {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  flex: none;
  margin-right: 2px;
}
[data-github-search] .ghs-history-chip {
  max-width: 200px;
  height: 24px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-github-search] .ghs-history-chip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
[data-github-search] .ghs-history-more {
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
  flex: none;
}
[data-github-search] .ghs-history-clear {
  margin-left: auto;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  flex: none;
}
[data-github-search] .ghs-history-clear:hover {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-border-l1);
}
[data-github-search] .ghs-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[data-github-search] .ghs-chip {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
[data-github-search] .ghs-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-github-search] .ghs-chip.is-on {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-button-ghost-active-fill);
}
[data-github-search] .ghs-select {
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12.5px;
}
[data-github-search] .ghs-spacer { flex: 1; }

[data-github-search] .ghs-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 32px;
}
[data-github-search] .ghs-meta {
  padding: 14px 0 10px;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary);
  display: flex;
  align-items: center;
  gap: 10px;
}
[data-github-search] .ghs-list { display: flex; flex-direction: column; gap: 10px; }
[data-github-search] .ghs-list.is-stale { opacity: 0.45; transition: opacity 120ms ease; pointer-events: none; }

[data-github-search] .ghs-card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 12px);
  /* bg-layer-1 在浅色主题下与页面底色同为纯白，卡片会没有轮廓；
     card-fill 是专为卡片准备的分层色（浅色 #fafafa / 深色 #212123）。 */
  background: var(--dsw-alias-card-fill);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 卡片本体不可点（只有头部按钮可点），所以这里不给 pointer。 */
  transition: border-color 120ms ease, background 120ms ease;
}
[data-github-search] .ghs-card:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-card-fill-hover); }
[data-github-search] .ghs-card.is-open { border-color: var(--dsw-alias-brand-primary); }
[data-github-search] .ghs-card-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-github-search] .ghs-card-head:hover .ghs-repo-name { color: var(--dsw-alias-link); }
[data-github-search] .ghs-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l1);
  flex: none;
}
[data-github-search] .ghs-fullname {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-link);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-github-search] .ghs-repo-name { font-weight: 600; }
[data-github-search] .ghs-owner { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
[data-github-search] .ghs-flag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
}
[data-github-search] .ghs-desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}
[data-github-search] .ghs-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary);
  flex-wrap: wrap;
}
[data-github-search] .ghs-stat { display: inline-flex; align-items: center; gap: 5px; }
[data-github-search] .ghs-lang-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-brand-primary); }
[data-github-search] .ghs-topics { display: flex; gap: 6px; flex-wrap: wrap; }
[data-github-search] .ghs-topic {
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}

[data-github-search] .ghs-detail {
  border-top: 1px dashed var(--dsw-alias-border-l1);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
[data-github-search] .ghs-detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }
[data-github-search] .ghs-small {
  height: 30px; padding: 0 12px; font-size: 12.5px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
[data-github-search] .ghs-small:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-github-search] a.ghs-small { text-decoration: none; }
[data-github-search] .ghs-small.is-on {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-button-ghost-active-fill);
}
[data-github-search] .ghs-small:disabled { opacity: 0.55; cursor: default; }
[data-github-search] .ghs-translate-note {
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
}
[data-github-search] .ghs-langs { display: flex; flex-direction: column; gap: 6px; }
[data-github-search] .ghs-lang-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
[data-github-search] .ghs-lang-name { width: 104px; flex: none; color: var(--dsw-alias-label-secondary); }
[data-github-search] .ghs-lang-bar { flex: 1; height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l1); overflow: hidden; }
[data-github-search] .ghs-lang-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); }
[data-github-search] .ghs-lang-pct { width: 44px; text-align: right; color: var(--dsw-alias-label-tertiary); flex: none; }
[data-github-search] .ghs-readme {
  max-height: 340px;
  overflow: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

[data-github-search] .ghs-empty {
  padding: 56px 20px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
[data-github-search] .ghs-empty-title { font-size: 14px; color: var(--dsw-alias-label-secondary); }
[data-github-search] .ghs-examples { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
[data-github-search] .ghs-error {
  margin: 16px 0;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-state-error-secondary);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  line-height: 1.6;
}
[data-github-search] .ghs-shimmer { color: var(--dsw-alias-label-tertiary); }
/* 给所有可交互元素补一条明确的焦点环，避免依赖浏览器默认描边。 */
[data-github-search] .ghs-btn:focus-visible,
[data-github-search] .ghs-chip:focus-visible,
[data-github-search] .ghs-small:focus-visible,
[data-github-search] .ghs-select:focus-visible,
[data-github-search] .ghs-history-chip:focus-visible,
[data-github-search] .ghs-history-clear:focus-visible,
[data-github-search] .ghs-card-head:focus-visible,
[data-github-search] .ghs-readme:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: var(--dsw-radius-sm, 8px);
}
[data-github-search] .ghs-more { display: flex; justify-content: center; padding: 18px 0 0; }
`

    /* ------------------------------------------------------------ 文案 */

    /**
     * 面板内文案。宿主语言变动时 document.documentElement.lang 会跟着变，
     * 这里每次调用都重读，所以切换界面语言不需要重新注册插件。
     * 未知 key 直接回退成 key 本身，不抛错、不显示空白。
     */
    const DICT = {
      zh: {
        panelTitle: 'GitHub 项目搜索',
        placeholder: '搜索 GitHub 项目，例如 vector database、agent framework…',
        search: '搜索',
        searching: '搜索中…',
        clear: '清空',
        clearHint: '清空输入框与结果，回到初始状态',
        sortBest: '最佳匹配',
        sortStars: '星标最多',
        sortForks: 'fork 最多',
        sortUpdated: '最近更新',
        allLanguages: '全部语言',
        filterLanguage: '按语言筛选',
        filterStars: '按星标数筛选',
        anyStars: '不限星标',
        nameOnly: '只搜名字',
        nameOnlyHint: '只匹配仓库名，而不是简介内容',
        quotaReading: '正在读取配额…',
        quotaUnknown: '配额未知',
        hasToken: '已配置 token',
        noToken: '未配置 token',
        tokenFromGh: 'token 来自本机 gh CLI 登录',
        emptyTitle: '输入关键词，直接在这里看 GitHub 项目',
        emptyHint: '结果会列出星标、语言、更新时间和简介；点开任意一项可以读 README、复制 clone 命令。',
        noneTitle: '没有找到匹配的项目',
        noneHint: '换个关键词，或者把语言、星标筛选放宽一点。',
        searchingGithub: '正在搜索 GitHub…',
        refreshing: '刷新中…',
        loadMore: '加载更多',
        loading: '加载中…',
        archived: '已归档',
        openInBrowser: '在浏览器打开',
        copyClone: '复制 clone 命令',
        copyUrl: '复制仓库地址',
        copiedClone: '已复制 clone 命令',
        copiedUrl: '已复制仓库地址',
        copyFailed: '复制失败，可直接选中：',
        historyLabel: '最近搜索',
        historyClear: '清空历史',
        historyClearHint: '清空全部搜索历史',
        historyMore: (n) => `还有 ${n} 条`,
        translateReadme: '翻译成中文',
        translating: '翻译中…',
        showOriginal: '看原文',
        translateTruncated: 'README 较长，只翻译了前 8000 字符',
        translatedLabel: 'README 译文',
        readingReadme: '正在读取 README…',
        retry: '重试',
        noReadme: '（这个仓库没有 README）',
        openIssues: ' 个 open issue',
        defaultBranch: '默认分支 ',
        createdAt: '创建于 ',
        updatedToday: '今天更新',
        updatedYesterday: '昨天更新',
        updatedDaysAgo: ' 天前更新',
        updatedMonthsAgo: ' 个月前更新',
        updatedYearsAgo: ' 年前更新',
        hitRepos: ' 个仓库',
        reachedCap: (total) => `已到 GitHub 搜索上限（前 ${total} 条），换个更精确的关键词能找到更多`,
        requestFailed: (code) => `请求失败（HTTP ${code}）`,
        clipboardDenied: '浏览器不允许写剪贴板',
        quotaLeft: '搜索剩余',
        quotaNoToken: ' 次（未配 token）',
      },
      en: {
        panelTitle: 'GitHub project search',
        placeholder: 'Search GitHub projects, e.g. vector database, agent framework…',
        search: 'Search',
        searching: 'Searching…',
        clear: 'Clear',
        clearHint: 'Clear the input and results, back to the initial state',
        sortBest: 'Best match',
        sortStars: 'Most stars',
        sortForks: 'Most forks',
        sortUpdated: 'Recently updated',
        allLanguages: 'All languages',
        filterLanguage: 'Filter by language',
        filterStars: 'Filter by stars',
        anyStars: 'Any stars',
        nameOnly: 'Name only',
        nameOnlyHint: 'Match the keywords against repository names only',
        quotaReading: 'Reading quota…',
        quotaUnknown: 'Quota unknown',
        hasToken: 'Token configured',
        noToken: 'No token',
        tokenFromGh: 'Token comes from the local gh CLI login',
        emptyTitle: 'Type a keyword to browse GitHub projects right here',
        emptyHint: 'Results list stars, language, last update and description; open any of them to read the README or copy the clone command.',
        noneTitle: 'No matching projects',
        noneHint: 'Try different keywords, or loosen the language and star filters.',
        searchingGithub: 'Searching GitHub…',
        refreshing: 'Refreshing…',
        loadMore: 'Load more',
        loading: 'Loading…',
        archived: 'archived',
        openInBrowser: 'Open in browser',
        copyClone: 'Copy clone command',
        copyUrl: 'Copy repository URL',
        copiedClone: 'Clone command copied',
        copiedUrl: 'Repository URL copied',
        copyFailed: 'Copy failed, select it here: ',
        historyLabel: 'Recent',
        historyClear: 'Clear history',
        historyClearHint: 'Clear all search history',
        historyMore: (n) => `+${n} more`,
        translateReadme: 'Translate to Chinese',
        translating: 'Translating…',
        showOriginal: 'Show original',
        translateTruncated: 'This README is long, so only the first 8000 characters were translated',
        translatedLabel: 'Translated README',
        readingReadme: 'Reading README…',
        retry: 'Retry',
        noReadme: '(this repository has no README)',
        openIssues: ' open issues',
        defaultBranch: 'Default branch ',
        createdAt: 'Created ',
        updatedToday: 'updated today',
        updatedYesterday: 'updated yesterday',
        updatedDaysAgo: ' days ago',
        updatedMonthsAgo: ' months ago',
        updatedYearsAgo: ' years ago',
        hitRepos: ' repositories',
        reachedCap: (total) => `GitHub stops at the first ${total} results — a more specific keyword reaches further`,
        requestFailed: (code) => `Request failed (HTTP ${code})`,
        clipboardDenied: 'The browser blocked clipboard access',
        quotaLeft: 'Searches left',
        quotaNoToken: ' (no token)',
      },
    }

    function localeId() {
      const tag = (typeof document !== 'undefined' ? document.documentElement.lang : '') || (typeof navigator !== 'undefined' ? navigator.language : '')
      if (!tag) return 'zh'
      return String(tag).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    function t(key, vars) {
      const dict = DICT[localeId()] ?? DICT.zh
      const value = dict[key] ?? DICT.zh[key] ?? key
      if (typeof value === 'function') return value(vars)
      if (vars === undefined) return value
      return String(value).replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])))
    }

    /* ------------------------------------------------------------ 工具函数 */

    function num(value) {
      const n = Number(value) || 0
      if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`
      if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`
      return String(n)
    }

    function since(iso) {
      if (!iso) return ''
      const then = new Date(iso).getTime()
      if (!Number.isFinite(then)) return ''
      const days = Math.floor((Date.now() - then) / 86400000)
      if (days <= 0) return t('updatedToday')
      if (days === 1) return t('updatedYesterday')
      if (days < 30) return `${days}${t('updatedDaysAgo')}`
      if (days < 365) return `${Math.floor(days / 30)}${t('updatedMonthsAgo')}`
      return `${Math.floor(days / 365)}${t('updatedYearsAgo')}`
    }

    /* ------------------------------------------------------------ 搜索历史 */

    /**
     * 读写 localStorage 里的搜索历史。
     *
     * 全部包在 try 里：隐私模式、禁用存储、配额满都会抛，而这些场景下
     * 历史功能失效是可接受的降级，不该让整个面板崩掉。
     */
    function readHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        // 存进来的可能是旧版本或手改过的数据，逐项过一遍才敢用。
        return parsed
          .filter((one) => typeof one === 'string')
          .map((one) => one.trim())
          .filter(Boolean)
          .slice(0, HISTORY_MAX)
      } catch {
        return []
      }
    }

    function writeHistory(list) {
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)))
        return true
      } catch {
        // 写不进去就算了，内存里的 state 仍然可用。
        return false
      }
    }

    /**
     * 把一条查询并进历史：已存在就提到最前，超出 10 条丢最旧的。
     * 大小写不敏感去重 —— 搜 "Rust" 和 "rust" 不该占两条。
     */
    function mergeHistory(list, keyword) {
      const text = String(keyword ?? '').trim()
      if (!text) return list
      const key = text.toLowerCase()
      return [text, ...list.filter((one) => one.toLowerCase() !== key)].slice(0, HISTORY_MAX)
    }

    async function api(path, init) {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        ...init,
      })
      let body = {}
      try {
        body = await response.json()
      } catch {
        /* 非 JSON 响应按空对象处理，下面统一按 status 报错。 */
      }
      if (!response.ok) throw new Error(body?.error ?? t('requestFailed', response.status))
      return body
    }

    function copyText(text) {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
      return Promise.reject(new Error(t('clipboardDenied')))
    }

    /* ------------------------------------------------------------ 图标 */

    function PanelIcon({ size = 18, active }) {
      const stroke = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return fsx('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        children: [
          h('circle', { cx: 10.5, cy: 10.5, r: 6.4, stroke, strokeWidth: 1.7 }),
          h('path', { d: 'M15.4 15.4 20 20', stroke, strokeWidth: 1.7, strokeLinecap: 'round' }),
          h('path', { d: 'M8 10.5h5M10.5 8v5', stroke, strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.75 }),
        ],
      })
    }

    function StarIcon({ size = 13 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
        children: h('path', {
          d: 'M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.8l5.9-.9z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
      })
    }

    function ForkIcon({ size = 13 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
        children: h('path', {
          d: 'M7 4v9a3 3 0 003 3h4M7 4a1.9 1.9 0 100 3.8A1.9 1.9 0 007 4zM17 12a1.9 1.9 0 100 3.8 1.9 1.9 0 000-3.8zM14 16v2.5',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }),
      })
    }

    /* ------------------------------------------------------------ 主面板 */

    /* ------------------------------------------------------------ 卡片 */

    /**
     * 一张结果卡片。
     *
     * 定义在模块作用域（不是 GithubSearch 内部），否则父组件每次重渲染都会
     * 生成新的组件类型，React 会把整棵卡片子树卸载重建：输入框每敲一个字，
     * 200 张卡片全部 remount，已展开的 README 滚动位置也会被重置。
     *
     * 外层不带 role="button"：里面还有链接和按钮，交互元素不能嵌套交互元素。
     * 折叠/展开由卡片头部的真实 <button> 负责，带 aria-expanded。
     */
    function RepoCard({ item, open, state, onToggle, onCopy, onTranslate, translate }) {
      return h('div', { className: `ghs-card ${open ? 'is-open' : ''}` }, [
        h('button', {
          key: 'head',
          type: 'button',
          className: 'ghs-card-head',
          'aria-expanded': open,
          onClick: () => onToggle(item),
        }, [
          item.ownerAvatar
            ? h('img', { key: 'a', className: 'ghs-avatar', src: item.ownerAvatar, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
            : h('span', { key: 'a', className: 'ghs-avatar' }),
          h('span', { key: 'n', className: 'ghs-fullname' }, [
            h('span', { key: 'o', className: 'ghs-owner' }, `${item.owner}/`),
            h('span', { key: 'r', className: 'ghs-repo-name' }, item.name),
          ]),
          item.archived ? h('span', { key: 'f1', className: 'ghs-flag' }, t('archived')) : null,
          item.isFork ? h('span', { key: 'f2', className: 'ghs-flag' }, 'fork') : null,
        ]),
        item.description
          ? h('div', { key: 'd', className: 'ghs-desc' }, item.description)
          : null,
        h('div', { key: 's', className: 'ghs-stats' }, [
          h('span', { key: 'st', className: 'ghs-stat' }, [h(StarIcon, { key: 'i' }), num(item.stars)]),
          h('span', { key: 'fk', className: 'ghs-stat' }, [h(ForkIcon, { key: 'i' }), num(item.forks)]),
          item.language
            ? h('span', { key: 'lg', className: 'ghs-stat' }, [
                h('span', { key: 'dot', className: 'ghs-lang-dot' }),
                item.language,
              ])
            : null,
          item.license ? h('span', { key: 'li', className: 'ghs-stat' }, item.license) : null,
          h('span', { key: 'up', className: 'ghs-stat' }, since(item.pushedAt || item.updatedAt)),
        ]),
        Array.isArray(item.topics) && item.topics.length
          ? h('div', { key: 't', className: 'ghs-topics' }, item.topics.slice(0, 8).map((topic) =>
              h('span', { key: topic, className: 'ghs-topic' }, topic)))
          : null,
        open ? h('div', { key: 'detail', className: 'ghs-detail' }, renderDetail({
          item,
          state,
          onRetry: () => onToggle(item, { force: true }),
          onCopy,
          onTranslate,
          translate,
        })) : null,
      ])
    }

    function renderDetail({ state, onRetry, onCopy, onTranslate, translate }) {
      if (!state || state.loading) {
        return [h('div', { key: 'l', className: 'ghs-shimmer' }, t('readingReadme'))]
      }
      if (state.error) {
        return [
          h('div', { key: 'e', className: 'ghs-error' }, state.error),
          h('div', { key: 'r', className: 'ghs-detail-actions' },
            h('button', { type: 'button', className: 'ghs-small', onClick: onRetry }, t('retry'))),
        ]
      }
      const repo = state.data ?? {}
      const languages = Array.isArray(repo.languages) ? repo.languages : []
      return [
        h('div', { key: 'actions', className: 'ghs-detail-actions' }, [
          h('a', {
            key: 'open', className: 'ghs-small', href: repo.url, target: '_blank', rel: 'noreferrer',
          }, t('openInBrowser')),
          h('button', {
            key: 'clone', type: 'button', className: 'ghs-small',
            onClick: () => onCopy(`git clone ${repo.cloneUrl}`, t('copiedClone')),
          }, t('copyClone')),
          h('button', {
            key: 'url', type: 'button', className: 'ghs-small',
            onClick: () => onCopy(repo.url, t('copiedUrl')),
          }, t('copyUrl')),
          // 翻译只在有 README 时出现；已经翻过就切成「看原文」。
          String(repo.readme ?? '').trim()
            ? h('button', {
                key: 'translate',
                type: 'button',
                className: `ghs-small ${translate?.text ? 'is-on' : ''}`,
                disabled: translate?.loading === true,
                onClick: () => onTranslate(),
              }, translate?.loading
                ? t('translating')
                : translate?.text ? t('showOriginal') : t('translateReadme'))
            : null,
        ]),
        languages.length
          ? h('div', { key: 'langs', className: 'ghs-langs' }, languages.map((one) =>
              h('div', { key: one.name, className: 'ghs-lang-row' }, [
                h('span', { key: 'n', className: 'ghs-lang-name' }, one.name),
                h('span', { key: 'b', className: 'ghs-lang-bar' },
                  h('span', { className: 'ghs-lang-fill', style: { width: `${one.percent}%` } })),
                h('span', { key: 'p', className: 'ghs-lang-pct' }, `${one.percent}%`),
              ])))
          : null,
        h('div', { key: 'stats', className: 'ghs-stats' }, [
          h('span', { key: 'issues', className: 'ghs-stat' }, `${num(repo.openIssues)}${t('openIssues')}`),
          h('span', { key: 'branch', className: 'ghs-stat' }, `${t('defaultBranch')}${repo.defaultBranch ?? '-'}`),
          h('span', { key: 'created', className: 'ghs-stat' }, `${t('createdAt')}${String(repo.createdAt ?? '').slice(0, 10) || '-'}`),
        ]),
        translate?.error
          ? h('div', { key: 'transErr', className: 'ghs-error' }, translate.error)
          : null,
        translate?.truncated && translate?.text
          ? h('div', { key: 'transNote', className: 'ghs-translate-note' }, t('translateTruncated'))
          : null,
        h('div', {
          key: 'readme',
          className: 'ghs-readme',
          tabIndex: 0,
          role: 'region',
          'aria-label': translate?.text ? t('translatedLabel') : 'README',
        }, (translate?.text || repo.readme) || t('noReadme')),
      ]
    }

    function GithubSearch() {
      const [draft, setDraft] = react.useState('')
      const [query, setQuery] = react.useState('')
      const [sort, setSort] = react.useState('best-match')
      const [language, setLanguage] = react.useState('')
      const [minStars, setMinStars] = react.useState(0)
      const [inName, setInName] = react.useState(false)

      const [items, setItems] = react.useState([])
      const [total, setTotal] = react.useState(0)
      const [page, setPage] = react.useState(1)
      const [loading, setLoading] = react.useState(false)
      const [loadingMore, setLoadingMore] = react.useState(false)
      const [error, setError] = react.useState(null)
      const [searched, setSearched] = react.useState(false)

      const [status, setStatus] = react.useState(null)
      const [history, setHistory] = react.useState([])
      const [openName, setOpenName] = react.useState(null)
      const [detail, setDetail] = react.useState({})
      // 翻译结果按仓库名缓存：{ [fullName]: { loading?, text?, truncated?, error? } }
      const [translated, setTranslated] = react.useState({})
      const [toast, setToast] = react.useState(null)

      const requestId = react.useRef(0)
      const toastTimer = react.useRef(0)
      const inputRef = react.useRef(null)

      const showToast = react.useCallback((text) => {
        window.clearTimeout(toastTimer.current)
        setToast(text)
        toastTimer.current = window.setTimeout(() => setToast(null), 2000)
      }, [])

      react.useEffect(() => () => window.clearTimeout(toastTimer.current), [])

      // 首屏查一次配额：让用户知道要不要配 token。
      react.useEffect(() => {
        let alive = true
        api('/status')
          .then((body) => { if (alive) setStatus(body) })
          .catch(() => { if (alive) setStatus({ authenticated: false, tokenSource: 'none', rate: {} }) })
        return () => { alive = false }
      }, [])

      react.useEffect(() => { inputRef.current?.focus() }, [])

      // 历史只在挂载时读一次；之后写都走 remember()，避免每帧读 localStorage。
      react.useEffect(() => {
        setHistory(readHistory())
      }, [])

      /**
       * 发一次搜索。overrides 用于「刚改了筛选项、状态还没提交」的场景，
       * 否则会拿上一次的筛选条件去搜。
       */
      const runSearch = react.useCallback(async (nextQuery, nextPage = 1, overrides = {}) => {
        const keyword = String(nextQuery ?? '').trim()
        if (!keyword) {
          inputRef.current?.focus()
          return
        }
        const nextSort = overrides.sort ?? sort
        const nextLanguage = overrides.language ?? language
        const nextMinStars = overrides.minStars ?? minStars
        const nextInName = overrides.inName ?? inName

        const ticket = ++requestId.current
        if (nextPage === 1) {
          setLoading(true)
          setError(null)
        } else {
          setLoadingMore(true)
        }
        setSearched(true)
        try {
          const body = await api('/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              query: keyword,
              sort: nextSort === 'best-match' ? undefined : nextSort,
              order: 'desc',
              language: nextLanguage || undefined,
              minStars: nextMinStars > 0 ? nextMinStars : undefined,
              inName: nextInName || undefined,
              limit: PAGE_SIZE,
              page: nextPage,
            }),
          })
          if (ticket !== requestId.current) return
          setItems((prev) => {
            if (nextPage === 1) return body.items
            // 去重：翻页越界或 GitHub 返回重叠时不会出现重复卡片。
            const seen = new Set(prev.map((one) => one.fullName))
            return [...prev, ...body.items.filter((one) => !seen.has(one.fullName))]
          })
          setTotal(body.total)
          setPage(nextPage)
          if (body.rate) setStatus({ authenticated: body.tokenSource !== 'none', tokenSource: body.tokenSource, rate: body.rate })
        } catch (err) {
          if (ticket !== requestId.current) return
          setError(String(err?.message ?? err))
          if (nextPage === 1) {
            setItems([])
            setTotal(0)
          }
        } finally {
          if (ticket === requestId.current) {
            setLoading(false)
            setLoadingMore(false)
          }
        }
      }, [sort, language, minStars, inName])

      /** 把一次成功发起的查询记进历史（内存与 localStorage 同步更新）。 */
      const remember = react.useCallback((keyword) => {
        setHistory((prev) => {
          const next = mergeHistory(prev, keyword)
          writeHistory(next)
          return next
        })
      }, [])

      /** 清空全部历史。只清历史，不动当前搜索结果 —— 那是「清空」按钮的事。 */
      const clearHistory = react.useCallback(() => {
        setHistory([])
        try {
          window.localStorage.removeItem(HISTORY_KEY)
        } catch {
          /* 存储不可用时内存里已经清空，功能上够用。 */
        }
      }, [])

      const submit = react.useCallback((event) => {
        event?.preventDefault?.()
        const keyword = draft.trim()
        if (!keyword) return
        setQuery(keyword)
        setOpenName(null)
        remember(keyword)
        void runSearch(keyword, 1)
      }, [draft, runSearch, remember])

      /**
       * 点历史标签：填入输入框并立刻重搜。
       * 复用 submit 的语义（同一套记住/清空/重搜逻辑），但不依赖表单事件。
       */
      const reuseKeyword = react.useCallback((keyword) => {
        const text = String(keyword ?? '').trim()
        if (!text) return
        setDraft(text)
        setQuery(text)
        setOpenName(null)
        remember(text)
        void runSearch(text, 1)
        inputRef.current?.focus()
      }, [remember, runSearch])

      /**
       * 回到初始状态：清空关键词、结果、详情缓存与筛选条件。
       *
       * requestId 必须递增 —— 否则清空时还在路上的那次搜索返回后会把结果
       * 重新填回列表，用户会看到"清空了又自己冒出来"。
       */
      const clearAll = react.useCallback(() => {
        requestId.current += 1
        setDraft('')
        setQuery('')
        setSort('best-match')
        setLanguage('')
        setMinStars(0)
        setInName(false)
        setItems([])
        setTotal(0)
        setPage(1)
        setLoading(false)
        setLoadingMore(false)
        setError(null)
        setSearched(false)
        setOpenName(null)
        setDetail({})
        setTranslated({})
        inputRef.current?.focus()
      }, [])

      /**
       * 展开/收起一张卡片，必要时拉取详情。
       * @param item - 被点击的仓库
       * @param options.force - 忽略已有缓存强制重取（重试用）
       */
      const openDetail = react.useCallback(async (item, options = {}) => {
        const name = item.fullName
        if (openName === name && options.force !== true) {
          setOpenName(null)
          return
        }
        setOpenName(name)
        // 只有成功的结果才缓存；失败与加载中都要允许重新请求。
        if (detail[name]?.data && options.force !== true) return
        // 同一张卡正在请求时不重复发（连点两下会打两次 Host，每次 3 个 GitHub 请求）。
        if (detail[name]?.loading && options.force !== true) return
        // 记住这次请求发起时的关键词编号：用户换了搜索，旧的详情不该再落地。
        const ticket = requestId.current
        setDetail((prev) => ({ ...prev, [name]: { loading: true } }))
        try {
          const body = await api(`/repo?repo=${encodeURIComponent(name)}`)
          setDetail((prev) => ({ ...prev, [name]: { data: body } }))
        } catch (err) {
          // 换了搜索之后才失败的旧请求，不覆盖当前结果。
          if (ticket !== requestId.current) return
          setDetail((prev) => ({ ...prev, [name]: { error: String(err?.message ?? err) } }))
        }
      }, [openName, detail])

      /** 复制一段文本并给出反馈；失败时把内容显示出来，让用户能手动选中。 */
      const copyAndToast = react.useCallback((text, okText) => {
        copyText(text).then(
          () => showToast(okText),
          () => showToast(`${t('copyFailed')}${text}`),
        )
      }, [showToast])

      // 配额展示是三态的：未知 / 偏低 / 正常。绿点在用户认知里等于「健康」，
      // 所以只有真的拿到数字且不低时才给绿色。
      /**
       * 翻译当前展开项的 README；已翻过的再点一次就切回原文。
       *
       * 翻译走 Host 的 /translate，由它调 Harness 的 translator 服务 —— 浏览器
       * 直连翻译接口既拿不到凭据，也绕不过跨域。
       */
      const toggleTranslate = react.useCallback(async (item) => {
        const name = item.fullName
        const current = translated[name]
        if (current?.text) {
          // 再点一次：清掉译文，回到原文。
          setTranslated((prev) => {
            const next = { ...prev }
            delete next[name]
            return next
          })
          return
        }
        const source = detail[name]?.data?.readme
        if (typeof source !== 'string' || !source.trim()) return
        if (current?.loading) return

        const ticket = requestId.current
        setTranslated((prev) => ({ ...prev, [name]: { loading: true } }))
        try {
          const body = await api('/translate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: source, target: 'zh-CN' }),
          })
          if (ticket !== requestId.current) return
          setTranslated((prev) => ({
            ...prev,
            [name]: { text: String(body?.text ?? ''), truncated: body?.truncated === true },
          }))
        } catch (err) {
          if (ticket !== requestId.current) return
          setTranslated((prev) => ({ ...prev, [name]: { error: String(err?.message ?? err) } }))
        }
      }, [translated, detail])

      const quota = status?.rate ?? {}
      const hasQuota = typeof quota.remaining === 'number' && typeof quota.limit === 'number' && quota.limit > 0
      const quotaLow = hasQuota && quota.remaining <= Math.max(2, Math.floor(quota.limit * 0.2))
      const quotaDotClass = status === null || status.error || !hasQuota
        ? 'ghs-quota-dot is-off'
        : quotaLow ? 'ghs-quota-dot is-low' : 'ghs-quota-dot'

      const quotaText = (() => {
        if (status === null) return t('quotaReading')
        if (status.error) return t('quotaUnknown')
        if (!hasQuota) return status.authenticated ? t('hasToken') : t('noToken')
        return `${t('quotaLeft')} ${quota.remaining}/${quota.limit}${status.tokenSource === 'none' ? t('quotaNoToken') : ''}`
      })()

      /* ---------------------------------------------------------- 渲染 */

      return h('div', { 'data-github-search': '' }, [
        h('style', { key: 'css' }, CSS),
        h('div', { key: 'top', className: 'ghs-top' }, [
          h('div', { key: 'title', className: 'ghs-title-row' }, [
            h('span', { key: 't', className: 'ghs-title' }, t('panelTitle')),
            h('span', { key: 'q', className: 'ghs-quota', title: status?.tokenSource === 'gh-cli' ? t('tokenFromGh') : undefined }, [
              h('span', { key: 'd', className: quotaDotClass }),
              quotaText,
            ]),
          ]),
          h('form', { key: 'search', className: 'ghs-search', onSubmit: submit }, [
            h('input', {
              key: 'input',
              ref: inputRef,
              className: 'ghs-input',
              value: draft,
              onChange: (event) => setDraft(event.target.value),
              placeholder: t('placeholder'),
              'aria-label': t('search'),
              autoComplete: 'off',
              spellCheck: false,
            }),
            h('button', {
              key: 'go',
              type: 'submit',
              className: 'ghs-btn is-primary',
              disabled: loading || draft.trim() === '',
            }, loading ? t('searching') : t('search')),
            h('button', {
              key: 'clear',
              type: 'button',
              className: 'ghs-btn',
              onClick: clearAll,
              // 没有可清的东西时禁用，避免一个永远可点但毫无反应的按钮。
              disabled: !searched && draft === '' && items.length === 0,
              title: t('clearHint'),
            }, t('clear')),
          ]),
          // 历史标签行：最多铺开 8 条，点一下填入并重搜。
          history.length > 0
            ? h('div', { key: 'history', className: 'ghs-history', 'aria-label': t('historyLabel') }, [
                h('span', { key: 'label', className: 'ghs-history-label' }, t('historyLabel')),
                ...history.slice(0, HISTORY_SHOWN).map((one) => h('button', {
                  key: one,
                  type: 'button',
                  className: 'ghs-history-chip',
                  title: one,
                  onClick: () => reuseKeyword(one),
                }, one)),
                // 超过 8 条时提示还有多少，不然用户不知道有 10 条。
                history.length > HISTORY_SHOWN
                  ? h('span', { key: 'more', className: 'ghs-history-more' },
                      t('historyMore', history.length - HISTORY_SHOWN))
                  : null,
                h('button', {
                  key: 'clear',
                  type: 'button',
                  className: 'ghs-history-clear',
                  onClick: clearHistory,
                  title: t('historyClearHint'),
                }, t('historyClear')),
              ])
            : null,
          h('div', { key: 'filters', className: 'ghs-filters' }, [
            ...SORTS.map((one) => h('button', {
              key: one.id,
              type: 'button',
              className: `ghs-chip ${sort === one.id ? 'is-on' : ''}`,
              'aria-pressed': sort === one.id,
              onClick: () => {
                if (sort === one.id) return
                setSort(one.id)
                if (query) { setOpenName(null); void runSearch(query, 1, { sort: one.id }) }
              },
            }, t(one.labelKey))),
            h('span', { key: 'sp', className: 'ghs-spacer' }),
            h('select', {
              key: 'lang',
              className: 'ghs-select',
              value: language,
              onChange: (event) => {
                const next = event.target.value
                setLanguage(next)
                if (query) { setOpenName(null); void runSearch(query, 1, { language: next }) }
              },
              'aria-label': t('filterLanguage'),
            }, [
              h('option', { key: '', value: '' }, t('allLanguages')),
              ...LANGUAGES.map((name) => h('option', { key: name, value: name }, name)),
            ]),
            h('select', {
              key: 'stars',
              className: 'ghs-select',
              value: String(minStars),
              onChange: (event) => {
                const next = Number(event.target.value)
                setMinStars(next)
                if (query) { setOpenName(null); void runSearch(query, 1, { minStars: next }) }
              },
              'aria-label': t('filterStars'),
            }, [
              h('option', { key: '0', value: '0' }, t('anyStars')),
              h('option', { key: '100', value: '100' }, '★100+'),
              h('option', { key: '1000', value: '1000' }, '★1k+'),
              h('option', { key: '10000', value: '10000' }, '★10k+'),
            ]),
            h('button', {
              key: 'inName',
              type: 'button',
              className: `ghs-chip ${inName ? 'is-on' : ''}`,
              'aria-pressed': inName,
              title: t('nameOnlyHint'),
              onClick: () => {
                const next = !inName
                setInName(next)
                if (query) { setOpenName(null); void runSearch(query, 1, { inName: next }) }
              },
            }, t('nameOnly')),
          ]),
        ]),

        h('div', { key: 'body', className: 'ghs-body' }, [
          error ? h('div', { key: 'err', className: 'ghs-error' }, error) : null,

          !searched && !loading
            ? h('div', { key: 'empty', className: 'ghs-empty' }, [
                h('div', { key: 't', className: 'ghs-empty-title' }, t('emptyTitle')),
                h('div', { key: 's' }, t('emptyHint')),
                h('div', { key: 'ex', className: 'ghs-examples' },
                  EXAMPLES.map((example) => h('button', {
                    key: example,
                    type: 'button',
                    className: 'ghs-chip',
                    onClick: () => reuseKeyword(example),
                  }, example))),
              ])
            : null,

          searched && !loading && !error && items.length === 0
            ? h('div', { key: 'none', className: 'ghs-empty' }, [
                h('div', { key: 't', className: 'ghs-empty-title' }, t('noneTitle')),
                h('div', { key: 's' }, t('noneHint')),
              ])
            : null,

          loading && items.length === 0
            ? h('div', { key: 'loading', className: 'ghs-empty' },
                h('div', { className: 'ghs-shimmer' }, t('searchingGithub')))
            : null,

          items.length > 0
            ? h('div', { key: 'meta', className: 'ghs-meta', 'aria-live': 'polite' }, [
                h('span', { key: 'q' }, `${query} · ${num(total)}${t('hitRepos')}`),
                loading ? h('span', { key: 'l', className: 'ghs-shimmer' }, t('refreshing')) : null,
              ])
            : null,

          items.length > 0
            ? h('div', { key: 'list', className: `ghs-list ${loading ? 'is-stale' : ''}` },
                items.map((item) => h(RepoCard, {
                  key: item.fullName,
                  item,
                  open: openName === item.fullName,
                  state: detail[item.fullName],
                  onToggle: openDetail,
                  onCopy: copyAndToast,
                  onTranslate: () => { void toggleTranslate(item) },
                  translate: translated[item.fullName],
                })))
            : null,

          items.length > 0 && items.length < total && page < MAX_PAGE
            ? h('div', { key: 'more', className: 'ghs-more' },
                h('button', {
                  type: 'button',
                  className: 'ghs-btn',
                  disabled: loadingMore,
                  onClick: () => { void runSearch(query, page + 1) },
                }, loadingMore ? t('loading') : t('loadMore')))
            : null,

          // 到顶时明确告诉用户停在哪，而不是把按钮藏掉让人以为还有。
          items.length > 0 && page >= MAX_PAGE && items.length < total
            ? h('div', { key: 'cap', className: 'ghs-more' },
                h('span', { className: 'ghs-shimmer' },
                  t('reachedCap', MAX_PAGE * PAGE_SIZE)))
            : null,
        ]),

        toast
          ? h('div', {
              key: 'toast',
              style: {
                position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                padding: '8px 16px', borderRadius: 10, fontSize: 13, zIndex: 60,
                background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)',
                border: '1px solid var(--dsw-alias-border-l2)',
                boxShadow: '0 6px 24px var(--dsw-alias-bg-mask-2)',
              },
              role: 'status',
            }, toast)
          : null,
      ])
    }

    /* ------------------------------------------------------------ 注册 */

    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(() =>
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 70, label: () => t('panelTitle') },
            PanelIcon,
          )),
        `${PLUGIN}: sidebar entry`)

      ctx.effect(() =>
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, GithubSearch)),
        `${PLUGIN}: main panel`)
    }

    module.exports = { apply, inject, name: PLUGIN }
    return module.exports
  },
})
