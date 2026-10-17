// Anonymous, rate-limited Exa hosted MCP. No provider key, browser profile,
// local server, agent_run, retries or alternate billing path is involved.
const endpoint = 'https://mcp.exa.ai/mcp';
export const discussionWebTools = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '搜尋目前網頁資料；用官方／原始來源優先、不同查詢與反面證據避免盲點。結果可能是摘要，重要資料再 read_webpage。免費 Exa 入口有流量限制，失敗不可冒充已查證。',
      parameters: {
        type: 'object',
        properties: {
          query: {type: 'string'},
          objective: {type: 'string', description: '本次要核對的問題、優先來源與排除條件'},
          numResults: {type: 'integer', minimum: 1}
        },
        required: ['query', 'objective'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_webpage',
      description:
        '透過 Exa 讀取公開網頁正文與來源資訊；不是登入瀏覽器。抽取可能不完整，圖片／版面／最新更新不能憑空推定。可提高 maxCharacters 取得更多原文。',
      parameters: {
        type: 'object',
        properties: {
          urls: {type: 'array', items: {type: 'string'}, minItems: 1},
          maxCharacters: {
            type: 'integer',
            minimum: 1,
            description: '每頁要求抽取的字元上限，預設 25000；不代表取得全文'
          }
        },
        required: ['urls'],
        additionalProperties: false
      }
    }
  }
];
const publicUrl = value => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('網頁網址無效。');
  }
  const host = url.hostname.toLowerCase();
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    !host.includes('.') ||
    /^\[|^\d+(?:\.\d+){3}$/u.test(host)
  )
    throw Error('網頁工具只讀不含登入資訊的公開網站；不存取本機或 IP 位址。');
  return url.href;
};
export function createDiscussionWebReader({signal, fetchImpl = fetch} = {}) {
  return async (name, args = {}) => {
    signal?.throwIfAborted();
    let tool, parameters;
    if (name === 'web_search') {
      if (
        typeof args.query !== 'string' ||
        !args.query.trim() ||
        typeof args.objective !== 'string' ||
        !args.objective.trim() ||
        args.objective.length > 4096
      )
        throw Error('搜尋需要問題與查證目標（目標最多 4096 字元）。');
      if (args.numResults !== undefined && (!Number.isSafeInteger(args.numResults) || args.numResults < 1))
        throw Error('搜尋結果數必須是正整數。');
      tool = 'web_search_exa';
      parameters = {query: args.query, objective: args.objective, numResults: args.numResults ?? 10};
    } else if (name === 'read_webpage') {
      if (!Array.isArray(args.urls) || !args.urls.length || args.urls.some(u => typeof u !== 'string'))
        throw Error('請提供要閱讀的公開網址。');
      if (args.maxCharacters !== undefined && (!Number.isSafeInteger(args.maxCharacters) || args.maxCharacters < 1))
        throw Error('網頁抽取範圍必須是正整數。');
      tool = 'web_fetch_exa';
      parameters = {urls: args.urls.map(publicUrl), maxCharacters: args.maxCharacters ?? 25000};
    } else throw Error('未提供此網頁工具。');
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    let response, body;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'},
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {name: tool, arguments: parameters}
        }),
        redirect: 'error',
        signal: active
      });
      if (!response.ok) throw Error();
      body = await response.text();
    } catch {
      signal?.throwIfAborted();
      throw Error(
        `Exa 網頁查詢失敗${response && !response.ok ? `（HTTP ${response.status}）` : ''}；免費入口可能受流量限制，未重送或改用付費來源。`
      );
    }
    signal?.throwIfAborted();
    const payloads = body.trim().startsWith('{')
      ? [body]
      : body
          .replace(/\r\n/gu, '\n')
          .split('\n\n')
          .map(event =>
            event
              .split('\n')
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart())
              .join('\n')
          )
          .filter(Boolean);
    for (const raw of payloads) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw Error('Exa 回傳格式無效；未取得可核對內容。');
      }
      if (data.id !== 1) continue;
      if (data.error || data.result?.isError) throw Error('Exa 搜尋／讀頁回報失敗；未取得可核對內容。');
      const text = data.result?.content
        ?.filter(c => c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('\n');
      if (!text?.trim()) throw Error('Exa 未回傳可閱讀內容。');
      return {
        source: 'Exa hosted MCP (anonymous)',
        queriedAt: new Date().toISOString(),
        ...(name === 'read_webpage'
          ? {requestedUrls: parameters.urls, requestedMaxCharactersPerPage: parameters.maxCharacters}
          : {}),
        content: text,
        scope: '搜尋／抽取结果可能受供應商摘要、快取、長度或網站限制；不能當作完整或即時頁面的保證。'
      };
    }
    throw Error('Exa 回傳缺少查詢結果。');
  };
}
