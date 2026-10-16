import {timingSafeEqual} from 'node:crypto';

// Shared front door of K's loopback MCP gateways (browser and worker). Each
// gateway keeps its own lifecycle, tools, cancellation and error responses.

export function bearerMatches(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7)),
    expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Answer and return false unless this is an authenticated loopback POST /mcp for `host`. */
export function admitMcpRequest(req, res, {host, token}) {
  if (
    !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
    req.headers.host !== host ||
    (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`)
  ) {
    res.writeHead(403).end();
    return false;
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!bearerMatches(req.headers.authorization, token)) {
    res.writeHead(401, {'WWW-Authenticate': 'Bearer'}).end();
    return false;
  }
  if (req.url !== '/mcp') {
    res.writeHead(404).end();
    return false;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, {Allow: 'POST'}).end();
    return false;
  }
  return true;
}

export async function readLimitedBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
