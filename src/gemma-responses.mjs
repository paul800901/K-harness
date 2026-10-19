import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {bearerMatches, readLimitedBody} from './mcp-http-guard.mjs';

// Codex 0.163 sends namespace/custom tools; the tested LM Studio Responses endpoint
// exposes only function tools. This translates the wire format, never executes tools,
// runs an agent loop, retries inference, or changes permissions/history.
export function gemmaRequest(body) {
  const aliases = new Map();
  const tools = [];
  const add = (tool, namespace) => {
    if (!['function', 'custom'].includes(tool.type)) throw Error(`Gemma 尚未支援工具格式：${tool.type}`);
    const name = namespace ? `${namespace}__${tool.name}` : tool.name;
    if (aliases.has(name)) throw Error('Gemma 工具名稱衝突；未送出推論。');
    aliases.set(name, {name: tool.name, namespace, custom: tool.type === 'custom'});
    tools.push(
      tool.type === 'custom'
        ? {
            type: 'function',
            name,
            description: `Transport wrapper: put the complete raw tool text in the JSON input field. The following original instructions apply to that inner text, not the wrapper.\n${tool.description ?? ''}${tool.format?.definition ? '\nInput grammar:\n' + tool.format.definition : ''}`,
            strict: false,
            parameters: {
              type: 'object',
              properties: {input: {type: 'string', description: 'The complete raw tool input.'}},
              required: ['input'],
              additionalProperties: false
            }
          }
        : {...tool, name}
    );
  };
  for (const tool of body.tools ?? []) {
    if (tool.type === 'namespace') for (const child of tool.tools ?? []) add(child, tool.name);
    else add(tool);
  }
  const input = Array.isArray(body.input)
    ? body.input.map(item => {
        if (item.type === 'custom_tool_call') {
          const {input, namespace, ...rest} = item;
          return {
            ...rest,
            type: 'function_call',
            name: namespace ? `${namespace}__${item.name}` : item.name,
            arguments: JSON.stringify({input})
          };
        }
        if (item.type === 'custom_tool_call_output') return {...item, type: 'function_call_output'};
        if (item.type === 'function_call' && item.namespace) {
          const {namespace, ...rest} = item;
          return {...rest, name: `${namespace}__${item.name}`};
        }
        return item;
      })
    : body.input;
  return {body: {...body, input, tools}, aliases};
}

function rawInput(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText);
    if (typeof parsed?.input === 'string') return parsed.input;
  } catch {}
  // Let the native tool reject malformed model input and return its error to the
  // model. A deterministic argument error must not look like a broken stream.
  return argumentsText ?? '';
}
function nativeItem(item, aliases, {started = false} = {}) {
  const alias = item?.type === 'function_call' && aliases.get(item.name);
  if (!alias) return item;
  const {arguments: args, ...rest} = item;
  return {
    ...rest,
    name: alias.name,
    ...(alias.namespace ? {namespace: alias.namespace} : {}),
    ...(alias.custom ? {type: 'custom_tool_call', input: started ? '' : rawInput(args)} : {arguments: args})
  };
}

export function gemmaResponseEvents(aliases) {
  const custom = new Map();
  return event => {
    const id = event.item?.id ?? event.item_id;
    if (event.type === 'response.output_item.added') {
      const alias = aliases.get(event.item?.name);
      if (alias?.custom) custom.set(id, {args: '', emitted: false});
      return [{...event, item: nativeItem(event.item, aliases, {started: true})}];
    }
    const state = custom.get(id);
    if (event.type === 'response.function_call_arguments.delta' && state) {
      state.args += event.delta ?? '';
      return [];
    }
    const flush = argumentsText => {
      if (!state || state.emitted) return [];
      const input = rawInput(argumentsText ?? state.args);
      state.emitted = true;
      return [
        {type: 'response.custom_tool_call_input.delta', item_id: id, output_index: event.output_index, delta: input},
        {type: 'response.custom_tool_call_input.done', item_id: id, output_index: event.output_index, input}
      ];
    };
    if (event.type === 'response.function_call_arguments.done' && state) return flush(event.arguments);
    if (event.type === 'response.output_item.done')
      return [...flush(event.item?.arguments), {...event, item: nativeItem(event.item, aliases)}];
    if (event.response?.output)
      return [
        {...event, response: {...event.response, output: event.response.output.map(item => nativeItem(item, aliases))}}
      ];
    return [event];
  };
}

export async function openGemmaResponses(baseUrl, {fetchImpl = fetch, expectedModel, acquireModel} = {}) {
  const requests = new Map();
  const token = randomBytes(32).toString('base64url');
  let expectedHost;
  const server = createServer(async (request, response) => {
    if (
      request.headers.host !== expectedHost ||
      request.headers.origin !== undefined ||
      !bearerMatches(request.headers.authorization, token)
    ) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end();
      return;
    }
    const abort = new AbortController();
    let complete;
    requests.set(
      abort,
      new Promise(resolve => {
        complete = resolve;
      })
    );
    response.on('close', () => abort.abort());
    let lease,
      upstreamStarted = false,
      settled = false;
    try {
      let translated;
      try {
        translated = gemmaRequest(JSON.parse((await readLimitedBody(request, 16 * 1024 * 1024)).toString('utf8')));
      } catch {
        response
          .writeHead(400, {'content-type': 'application/json'})
          .end(JSON.stringify({error: {message: 'Gemma 請求或工具格式無效；未送出推論。'}}));
        return;
      }
      const {body, aliases} = translated;
      if (expectedModel !== undefined && body.model !== expectedModel) {
        response
          .writeHead(400, {'content-type': 'application/json'})
          .end(JSON.stringify({error: {message: '自架模型與此聊天室連線不符；未送出推論。'}}));
        return;
      }
      if (acquireModel) {
        try {
          lease = await acquireModel({signal: abort.signal});
        } catch (error) {
          response
            .writeHead(503, {'content-type': 'application/json'})
            .end(JSON.stringify({error: {message: error.message}}));
          return;
        }
        body.model = lease.model;
      }
      abort.signal.throwIfAborted();
      upstreamStarted = true;
      const upstream = await fetchImpl(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
        signal: abort.signal,
        redirect: 'error'
      });
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      response.writeHead(upstream.status, {'content-type': contentType});
      if (!upstream.ok) {
        const errorBody = await upstream.text();
        settled = true;
        response.end(errorBody);
        return;
      }
      if (!body.stream) {
        const result = await upstream.json();
        settled = true;
        response.end(JSON.stringify({...result, output: result.output?.map(item => nativeItem(item, aliases))}));
        return;
      }
      const translate = gemmaResponseEvents(aliases),
        decoder = new TextDecoder();
      let buffer = '';
      const emit = frame => {
        const data = frame
          .split(/\r?\n/u)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (!data) return;
        if (data === '[DONE]') {
          settled = true;
          response.write('data: [DONE]\n\n');
          return;
        }
        const nativeEvent = JSON.parse(data);
        if (['response.completed', 'response.failed', 'response.incomplete'].includes(nativeEvent.type)) settled = true;
        for (const event of translate(nativeEvent))
          response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      for await (const chunk of upstream.body) {
        buffer += decoder.decode(chunk, {stream: true});
        let boundary;
        while ((boundary = /\r?\n\r?\n/u.exec(buffer))) {
          emit(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) emit(buffer);
      response.end();
    } catch (error) {
      if (!response.headersSent)
        response
          .writeHead(502, {'content-type': 'application/json'})
          .end(JSON.stringify({error: {message: 'Gemma 協定轉換或連線失敗；未改用其他模型。'}}));
      else response.destroy(error);
    } finally {
      try {
        await lease?.finish({
          settled: !upstreamStarted || settled,
          ...(!settled && upstreamStarted && abort.signal.aborted ? {cancelled: true} : {})
        });
      } catch {
        // The runtime retains an uncertain cancellation/unload result. Do not
        // interrupt K shutdown or retry a possibly completed operation.
      } finally {
        requests.delete(abort);
        complete();
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  expectedHost = `127.0.0.1:${server.address().port}`;
  return {
    baseUrl: `http://${expectedHost}/v1`,
    headers: {Authorization: `Bearer ${token}`},
    async close() {
      for (const abort of requests.keys()) abort.abort();
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      await Promise.all(requests.values());
    }
  };
}
