import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Official local Codex runtime owns login and conversation state. K never reads
// auth.json or forwards OAuth credentials to Pi or DeepSeek.
export function openCodexHost({ executable, cwd, onEvent = () => {}, onRequest }) {
  const child = spawn(executable, ['app-server', '--stdio'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map(), serverRequests = new Set(); let nextId = 0; let stopped = false;
  const startup = new Map(); const startupWaiters = new Set();
  const lines = createInterface({ input: child.stdout });
  function failAll() {
    stopped = true;
    serverRequests.clear();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex host stopped; inspect existing work before retrying.')); }
    pending.clear();
    for (const waiter of startupWaiters) waiter.fail();
  }
  const exited = new Promise(resolve => { child.once('exit', () => { failAll(); resolve(); }); child.once('error', () => { failAll(); resolve(); }); });
  child.stdin.on('error',failAll);
  const send = message => { if (stopped) throw new Error('Codex host is closed.'); child.stdin.write(JSON.stringify(message)+'\n'); };
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.method) {
      if(message.method==='serverRequest/resolved')serverRequests.delete(message.params?.requestId);
      if (message.method === 'mcpServer/startupStatus/updated') {
        startup.set(`${message.params.threadId}:${message.params.name}`,message.params);
        for (const waiter of startupWaiters) waiter.check();
      }
      // No invisible approvals. Unsupported server requests fail closed.
      if (message.id !== undefined) {
        serverRequests.add(message.id);
        Promise.resolve().then(()=>onRequest?.(message)).then(result=>{
          if(!serverRequests.delete(message.id)||stopped)return;
          if(result===undefined)send({id:message.id,error:{code:-32601,message:'This K client does not grant this request.'}});
          else send({id:message.id,result});
        }).catch(()=>{if(serverRequests.delete(message.id)&&!stopped)send({id:message.id,error:{code:-32603,message:'K request handler failed; permission not granted.'}});});
      }
      else onEvent(message);
      return;
    }
    const p = pending.get(message.id); if (!p) return;
    pending.delete(message.id); clearTimeout(p.timer);
    if (message.error) {
      const error=new Error(`Codex request ${p.method} failed (code ${message.error.code}).`);
      error.protocolMessage=message.error.message;
      p.reject(error);
    }
    else p.resolve(message.result);
  });
  return {
    closed: exited,
    notify: send,
    waitForMcp(threadId, name, timeoutMs=35000) {
      if(stopped)return Promise.reject(new Error('Codex host is closed.'));
      return new Promise((resolve,reject)=>{
        let timer;
        const end=(error,value)=>{clearTimeout(timer);startupWaiters.delete(waiter);error?reject(error):resolve(value);};
        const waiter={fail:()=>end(new Error('Codex host stopped before MCP readiness.')),check:()=>{
          const status=startup.get(`${threadId}:${name}`);
          if(status?.status==='ready')end(null,status);
          else if(['failed','cancelled'].includes(status?.status))end(new Error('K worker connection failed; no turn started.'));
        }};
        startupWaiters.add(waiter);timer=setTimeout(()=>end(new Error('K worker startup timed out; no turn started.')),timeoutMs);waiter.check();
      });
    },
    request(method, params, timeoutMs = 30000) {
      if (stopped) return Promise.reject(new Error('Codex host is closed.'));
      return new Promise((resolve,reject) => {
        const id=++nextId;
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Codex ${method} timed out; do not replay automatically.`));},timeoutMs);
        pending.set(id,{resolve,reject,timer,method});send({id,method,params});
      });
    },
    async close() {
      child.stdin.end(); const timer=setTimeout(()=>child.kill(),3000);
      await exited;clearTimeout(timer);lines.close();
    },
  };
}
