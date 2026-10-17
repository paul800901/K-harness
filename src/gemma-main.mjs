import path from 'node:path';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {openGemmaResponses} from './gemma-responses.mjs';

const defaults = {
  local: {baseUrl: 'http://127.0.0.1:1234/v1', model: 'gemma-4-12b-it-qat', contextWindow: 32768},
  cloud: {baseUrl: 'http://127.0.0.1:18080/v1', model: 'gemma-4-12b-qat-bf16', contextWindow: 32768}
};

// Self-hosted inference, not an OpenAI API billing route. Cloud uses an owner-managed
// SSH tunnel; K neither rents a server nor stores/transfers a provider credential.
export async function loadGemmaConnections(root, {fetchImpl = fetch} = {}) {
  try {
    return await readConnections(root, fetchImpl);
  } catch {
    // A bad optional Gemma file cannot take the existing three providers offline.
    return Object.entries(defaults).map(([slot, config]) => ({
      slot,
      model: `gemma-${slot}/${config.model}`,
      nativeModel() {
        throw new Error('Gemma 連線設定無效；未切換模型或計費。');
      },
      async models() {
        return {
          models: [
            {
              model: `gemma-${slot}/${config.model}`,
              provider: 'gemma',
              displayName: slot === 'local' ? 'Gemma 4 · 本機量化版' : 'Gemma 4 · 雲端高精度版',
              available: false,
              description: 'Gemma 連線設定無效，請修正 K 私有狀態中的 gemma-main.json。'
            }
          ]
        };
      }
    }));
  }
}
async function readConnections(root, fetchImpl) {
  let settings = {};
  try {
    settings = JSON.parse(await readFile(path.join(root, '.runtime', 'gemma-main.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Gemma 連線設定無法讀取；未改用其他供應商。');
  }
  return Object.entries(defaults).map(([slot, fallback]) => {
    const config = {...fallback, ...settings[slot]};
    const url = new URL(config.baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/u, '') !== '/v1'
    )
      throw new Error('Gemma 端點須為本機 /v1；雲端請使用 SSH 本機轉送，不在設定中放憑證。');
    if (
      typeof config.model !== 'string' ||
      !config.model.trim() ||
      config.model.length > 220 ||
      !Number.isInteger(config.contextWindow) ||
      config.contextWindow < 1024
    )
      throw new Error('Gemma 模型或上下文設定無效。');
    const baseUrl = url.href.replace(/\/$/u, '');
    const model = `gemma-${slot}/${config.model}`;
    const displayName = slot === 'local' ? 'Gemma 4 · 本機量化版' : 'Gemma 4 · 雲端高精度版';
    const home = path.join(root, '.runtime', `gemma-${slot}-home`);
    const catalogFile = path.join(home, 'model-catalog.json');
    let prepared, transport;
    const row = {
      id: model,
      model,
      provider: 'gemma',
      displayName,
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      inputModalities: ['text'],
      serviceTiers: []
    };
    return {
      slot,
      model,
      home,
      nativeModel(value) {
        if (value !== model) throw new Error('Gemma 連線與聊天室模型不符，請建立新對話；未轉送歷史。');
        return config.model;
      },
      async models({signal} = {}) {
        try {
          const timeout = AbortSignal.timeout(3000);
          const response = await fetchImpl(`${baseUrl}/models`, {
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            redirect: 'error'
          });
          if (!response.ok) throw new Error('endpoint unavailable');
          const result = await response.json();
          if (!result.data?.some(entry => entry.id === config.model))
            return {models: [{...row, available: false, description: `端點未提供模型 ${config.model}。`}]};
          return {
            models: [
              {
                ...row,
                available: true,
                description: `${config.model}；沿用 K 原生操作。端點列出模型不代表已完成推論驗證。`
              }
            ]
          };
        } catch (error) {
          signal?.throwIfAborted();
          return {
            models: [
              {
                ...row,
                available: false,
                description:
                  slot === 'local' ? '本機模型服務尚未連通。' : '雲端模型服務尚未連通；請先啟動租用機器與 SSH 轉送。'
              }
            ]
          };
        }
      },
      async prepare() {
        return (prepared ??= (async () => {
          await mkdir(home, {recursive: true});
          try {
            await writeFile(path.join(home, 'config.toml'), '[windows]\nsandbox = "unelevated"\n', {flag: 'wx'});
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
          // Complete metadata for the installed native catalog contract; no GPT branding,
          // fake effort/Fast options, or fabricated multimodal support.
          await writeFile(
            catalogFile,
            JSON.stringify({
              models: [
                {
                  slug: config.model,
                  display_name: displayName,
                  description: config.model,
                  default_reasoning_level: null,
                  supported_reasoning_levels: [],
                  shell_type: 'unified_exec',
                  visibility: 'list',
                  supported_in_api: true,
                  priority: 0,
                  additional_speed_tiers: [],
                  service_tiers: [],
                  availability_nux: null,
                  upgrade: null,
                  model_messages: null,
                  include_skills_usage_instructions: true,
                  include_plugin_usage_instructions: true,
                  include_apps_usage_instructions: true,
                  default_reasoning_summary: 'none',
                  support_verbosity: false,
                  default_verbosity: null,
                  apply_patch_tool_type: 'freeform',
                  web_search_tool_type: 'text_and_image',
                  truncation_policy: {mode: 'tokens', limit: 10000},
                  supports_image_detail_original: false,
                  context_window: config.contextWindow,
                  max_context_window: config.contextWindow,
                  comp_hash: null,
                  effective_context_window_percent: 95,
                  experimental_supported_tools: [],
                  input_modalities: ['text'],
                  supports_search_tool: false,
                  supports_experimental_context: false,
                  use_responses_lite: false,
                  supports_reasoning_effort_updates: false,
                  node_repl_auto_review_required: false,
                  node_repl_disabled: false,
                  base_instructions:
                    'You are a helpful assistant. Follow the user and project instructions. Use the available tools when needed. Never claim an action or result without evidence.',
                  tool_mode: null,
                  multi_agent_version: null
                }
              ]
            })
          );
          transport = await openGemmaResponses(baseUrl, {fetchImpl});
        })().catch(error => {
          prepared = null;
          throw error;
        }));
      },
      async close() {
        await prepared?.catch(() => {});
        await transport?.close();
        transport = null;
        prepared = null;
      },
      configOverrides() {
        if (!transport) throw new Error('Gemma 連線尚未準備完成；未繞過工具格式轉換。');
        return [
          `model_catalog_json=${JSON.stringify(catalogFile)}`,
          'model_provider="k_gemma"',
          `model=${JSON.stringify(config.model)}`,
          `review_model=${JSON.stringify(config.model)}`,
          `model_providers.k_gemma={name="Gemma",base_url=${JSON.stringify(transport.baseUrl)},wire_api="responses",requires_openai_auth=false,supports_websockets=false,http_headers={Authorization=${JSON.stringify(transport.headers.Authorization)}}}`,
          'web_search="disabled"',
          // The fresh, unauthenticated self-host home has no OpenAI account plugins.
          // Avoid native startup downloading the curated marketplace. K MCP tools stay intact.
          'features.plugins=false',
          'features.apps=false'
        ];
      }
    };
  });
}
