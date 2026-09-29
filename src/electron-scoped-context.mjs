import {EventEmitter} from 'node:events';

const unsupportedMethods = new Set([
  'route','unroute','addInitScript','cookies','addCookies','clearCookies',
  'storageState','setStorageState','grantPermissions','clearPermissions',
  'setGeolocation','setExtraHTTPHeaders','setHTTPCredentials','setOffline',
]);

/**
 * A fail-closed BrowserContext-shaped view for the official Playwright MCP.
 * The trusted owner is the sole source of page ownership and lifecycle.
 * This is a tool-scope adapter, not an OS or Electron-session isolation boundary.
 */
export function createElectronScopedContext({listPages,createPage,closeScope,newCDPSession,events}={}){
  if(typeof listPages!=='function'||typeof createPage!=='function'||typeof closeScope!=='function')
    throw new TypeError('Trusted listPages, createPage, and closeScope callbacks are required.');
  if(!events||typeof events.on!=='function'||typeof events.off!=='function')
    throw new TypeError('An owner page event emitter is required.');

  const exposed=new EventEmitter();
  const patched=new Set();
  let closed=false,closePromise=null;
  const isThenable=value=>value&&typeof value.then==='function';
  const ownerPages=()=>{
    const pages=listPages();
    if(isThenable(pages)||!Array.isArray(pages)||pages.some(page=>!page||typeof page!=='object'))
      throw new Error('Owner page inventory is unavailable.');
    return pages;
  };
  const patchPage=page=>{
    if(patched.has(page))return;
    const previous=Object.getOwnPropertyDescriptor(page,'context');
    if(previous&&!previous.configurable)throw new Error('Owned page context cannot be safely scoped.');
    Object.defineProperty(page,'context',{configurable:true,enumerable:previous?.enumerable??false,writable:false,value:()=>scoped});
    patched.add(page);
  };
  const assertOwned=page=>{
    if(closed)throw new Error('Electron browser scope is closed.');
    if(!ownerPages().includes(page))throw new Error('Page is outside this Electron browser scope.');
    patchPage(page);
    return page;
  };
  const onOwnerPage=page=>{
    if(closed)return;
    let owned=false;
    try{owned=ownerPages().includes(page);}catch(error){exposed.emit('scope-error',error);return;}
    if(!owned)return;
    try{patchPage(page);exposed.emit('page',page);}catch(error){exposed.emit('scope-error',error);}
  };
  const onOwnerClose=()=>{
    if(closed)return;
    closed=true;
    events.off('page',onOwnerPage);events.off('close',onOwnerClose);
    exposed.emit('close');
  };

  const scopedTarget={
    // Playwright Frame.waitForURL reads baseURL through Page.context(). This
    // scope uses absolute URLs only, never the shared owner's context options.
    _options:Object.freeze({baseURL:undefined}),
    // MCP reads this even with debugging disabled. Never expose the shared
    // browser's debugger, whose pause details may belong to the owner UI.
    debugger:Object.freeze({pausedDetails:()=>null}),
    pages(){
      if(closed)return [];
      return ownerPages().map(patchAndReturn);
    },
    async newPage(){
      if(closed)throw new Error('Electron browser scope is closed.');
      const page=await createPage();
      return assertOwned(page);
    },
    async newCDPSession(page){
      assertOwned(page);
      if(typeof newCDPSession!=='function')throw new Error('CDP sessions are not available in this Electron browser scope.');
      return newCDPSession(page);
    },
    browser(){return null;},
    isClosed(){return closed;},
    async close(){
      if(closePromise)return closePromise;
      closePromise=(async()=>{
        if(!closed)await closeScope();
        onOwnerClose();
      })();
      try{return await closePromise;}catch(error){closePromise=null;throw error;}
    },
    on(event,listener){exposed.on(event,listener);return scoped;},
    once(event,listener){exposed.once(event,listener);return scoped;},
    off(event,listener){exposed.off(event,listener);return scoped;},
    removeListener(event,listener){exposed.removeListener(event,listener);return scoped;},
    removeAllListeners(event){exposed.removeAllListeners(event);return scoped;},
    emit(event,...args){return exposed.emit(event,...args);},
  };
  function patchAndReturn(page){patchPage(page);return page;}
  for(const method of unsupportedMethods)scopedTarget[method]=()=>{
    throw new Error(`BrowserContext.${method} is not available in the scoped Electron MCP context.`);
  };
  const scoped=new Proxy(scopedTarget,{
    get(target,property,receiver){
      if(Reflect.has(target,property))return Reflect.get(target,property,receiver);
      if(property==='then')return undefined;
      if(typeof property==='symbol')return undefined;
      throw new Error(`BrowserContext.${String(property)} is not available in the scoped Electron MCP context.`);
    },
  });

  // Seed only pages already classified as owned by the trusted owner.
  for(const page of ownerPages())patchPage(page);
  events.on('page',onOwnerPage);
  events.on('close',onOwnerClose);
  return scoped;
}
