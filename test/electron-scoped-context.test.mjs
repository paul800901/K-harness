import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createElectronScopedContext} from '../src/electron-scoped-context.mjs';

function makePage(name){
  const rawContext={name:`raw-${name}`};
  return {name,context(){return rawContext;}};
}

function fixture(){
  const events=new EventEmitter(),owned=new Set(),calls={create:0,close:0,appClose:0,cdp:[]};
  const context=createElectronScopedContext({
    listPages:()=>[...owned],
    createPage:async()=>{calls.create++;const page=makePage(`owned-${calls.create}`);owned.add(page);return page;},
    closeScope:async()=>{calls.close++;},
    newCDPSession:async page=>{calls.cdp.push(page);return {target:page.name};},
    events,
  });
  return {context,events,owned,calls};
}

test('only owner-listed pages and page events enter the scoped context',()=>{
  const f=fixture(),owned=makePage('owned-initial'),foreign=makePage('foreign');
  f.owned.add(owned);
  assert.deepEqual(f.context.pages(),[owned]);
  assert.equal(owned.context(),f.context,'page.context cannot escape back to Electron default context');
  const emitted=[];f.context.on('page',page=>emitted.push(page));
  f.events.emit('page',foreign);
  assert.deepEqual(emitted,[],'foreign page event is dropped');
  f.owned.add(foreign);
  f.events.emit('page',foreign);
  assert.deepEqual(emitted,[foreign],'owner-classified page event is forwarded');
  assert.equal(foreign.context(),f.context);
});

test('newPage is owner-created and newCDPSession rejects foreign targets before callback',async()=>{
  const f=fixture(),foreign=makePage('foreign');
  const page=await f.context.newPage();
  assert.equal(f.calls.create,1);
  assert.deepEqual(f.context.pages(),[page]);
  assert.equal(page.context(),f.context);
  assert.deepEqual(await f.context.newCDPSession(page),{target:page.name});
  assert.deepEqual(f.calls.cdp,[page]);
  await assert.rejects(f.context.newCDPSession(foreign),/outside this Electron browser scope/u);
  assert.deepEqual(f.calls.cdp,[page],'foreign page is denied before owner CDP callback');
});

test('close closes only the scope and is idempotent; no raw context or unknown method fallback',async()=>{
  const f=fixture(),page=makePage('owned');f.owned.add(page);f.context.pages();
  let closedEvents=0;f.context.once('close',()=>closedEvents++);
  await Promise.all([f.context.close(),f.context.close()]);
  assert.equal(f.calls.close,1);
  assert.equal(f.calls.appClose,0,'scope closure never calls an application-close capability');
  assert.equal(closedEvents,1);
  assert.equal(f.context.isClosed(),true);
  assert.deepEqual(f.context.pages(),[]);
  assert.equal(page.context(),f.context,'closed scope remains the page context; it never restores a raw-context escape');
  await assert.rejects(f.context.newCDPSession(page),/scope is closed/u);
  assert.throws(()=>f.context.cookies(),/not available/u);
  assert.throws(()=>f.context.route('**/*',()=>{}),/not available/u);
  assert.throws(()=>f.context.addInitScript('x'),/not available/u);
  assert.throws(()=>f.context.rawContext,/not available/u);
  assert.throws(()=>f.context.unknownMethod(),/not available/u);
});

test('external owner close event closes the facade without asking it to close the app',()=>{
  const f=fixture();let closedEvents=0;
  f.context.once('close',()=>closedEvents++);
  f.events.emit('close');
  assert.equal(f.context.isClosed(),true);
  assert.equal(closedEvents,1);
  assert.equal(f.calls.close,0);
  assert.equal(f.calls.appClose,0);
});

test('failed owner close remains open and can be retried',async()=>{
  const events=new EventEmitter();let attempts=0;
  const context=createElectronScopedContext({listPages:()=>[],createPage:async()=>makePage('unused'),closeScope:async()=>{
    if(++attempts===1)throw new Error('scope still has a live page');
  },events});
  await assert.rejects(context.close(),/scope still has a live page/u);
  assert.equal(context.isClosed(),false);
  await context.close();
  assert.equal(attempts,2);
  assert.equal(context.isClosed(),true);
});
