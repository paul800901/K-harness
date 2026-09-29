import test from 'node:test';
import assert from 'node:assert/strict';
import {createElectronBrowserUrlGuard} from '../src/electron-browser-views.mjs';

test('protected local ports are denied across host aliases and blob source origins',()=>{
  const allowed=createElectronBrowserUrlGuard({
    blockedOrigins:['http://127.0.0.1:47831','http://127.0.0.1:47971'],
  });
  for(const url of [
    'http://127.0.0.1:47831/health',
    'http://localhost:47831/health',
    'http://[::1]:47831/health',
    'https://example.invalid:47831/path',
    'ws://localhost:47971/devtools/browser/1',
    'wss://[::1]:47971/devtools/browser/1',
    'blob:http://localhost:47831/id',
    'blob:https://example.invalid:47971/id',
  ])assert.equal(allowed(url),false,`${url} must be denied`);
});

test('ordinary HTTP, HTTPS, WS, WSS and supported local/inline URLs remain usable',()=>{
  const allowed=createElectronBrowserUrlGuard({blockedOrigins:['http://127.0.0.1:47831']});
  for(const url of [
    'http://example.com/path',
    'https://example.com/path',
    'ws://example.com/socket',
    'wss://example.com/socket',
    'about:blank',
    'data:text/html,ok',
    'blob:https://example.com/id',
  ])assert.equal(allowed(url),true,`${url} should remain usable`);
  assert.equal(createElectronBrowserUrlGuard({blockedPorts:[47831]})('https://example.invalid:47831/'),false);
});

test('file, javascript, opaque blob and credential-bearing URLs are denied',()=>{
  const allowed=createElectronBrowserUrlGuard();
  for(const url of [
    'file:///C:/private.txt',
    'javascript:alert(1)',
    'http://user:pass@example.com/',
    'https://user@example.com/',
    'ws://user:pass@example.com/socket',
    'blob:https://user:pass@example.com/id',
    'blob:null/id',
  ])assert.equal(allowed(url),false,`${url} must be denied`);
});

test('invalid configured protected ports fail closed at setup',()=>{
  assert.throws(()=>createElectronBrowserUrlGuard({blockedPorts:[0]}),/Invalid protected browser port/u);
  assert.throws(()=>createElectronBrowserUrlGuard({blockedPorts:[65536]}),/Invalid protected browser port/u);
});
