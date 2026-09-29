import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,lstat,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareNativeDownloads} from '../src/electron-download.mjs';

function fakeDownload(){
  const item=new EventEmitter();
  item.getFilename=()=> 'setup.exe';
  item.getURL=()=> 'https://user:secret@example.test/setup.exe?token=hidden';
  item.setSavePath=value=>{item.savePath=value;};
  return item;
}

test('native Electron download uses opaque staging and copies only through the adapter',async()=>{
  const profileRoot=await mkdtemp(path.join(os.tmpdir(),'k-electron-download-'));
  const stagingRoot=path.join(profileRoot,'native-download-staging'),output=path.join(profileRoot,'output');
  await mkdir(output);
  let adapter,called=0;
  const willDownload=await prepareNativeDownloads({profileRoot,stagingRoot,onDownload:value=>{called++;adapter=value;}});
  const item=fakeDownload(),prevented={value:false};
  assert.equal(willDownload({preventDefault(){prevented.value=true;}},item,{id:42}),true);
  assert.equal(prevented.value,false);assert.equal(called,1);
  assert.match(item.savePath,/^[\s\S]*[0-9a-f-]{36}\.download$/u);
  assert.equal(path.dirname(item.savePath),stagingRoot);
  assert.doesNotMatch(path.basename(item.savePath),/setup|exe|secret|token/iu);
  assert.equal(adapter.suggestedFilename(),'setup.exe');
  assert.equal(adapter.url(),'https://user:secret@example.test/setup.exe?token=hidden','the live session owns URL redaction');
  const destination=path.join(output,'copy.exe');
  const pending=adapter.saveAs(destination);
  await writeFile(item.savePath,'FAKE_NATIVE_DOWNLOAD');
  item.emit('done',{},'completed');
  await pending;
  assert.equal(await readFile(destination,'utf8'),'FAKE_NATIVE_DOWNLOAD');
  assert.equal((await lstat(item.savePath)).isFile(),true,'the helper retains the opaque staged copy');
  if(process.platform==='win32')assert.equal(await readFile(`${item.savePath}:Zone.Identifier`,'utf8'),'[ZoneTransfer]\r\nZoneId=3\r\n');
  await assert.rejects(adapter.saveAs(destination),error=>error.code==='EEXIST','the adapter never overwrites an existing managed destination');
});

test('native download setup and failed items fail closed',async()=>{
  const profileRoot=await mkdtemp(path.join(os.tmpdir(),'k-electron-download-deny-'));
  await assert.rejects(prepareNativeDownloads({profileRoot,stagingRoot:path.join(path.dirname(profileRoot),'outside-staging'),onDownload:()=>{}}),/inside the browser profile/u);
  const willDownload=await prepareNativeDownloads({profileRoot,stagingRoot:path.join(profileRoot,'staging'),onDownload:()=>{}});
  const item=fakeDownload();let prevented=false;
  assert.equal(willDownload({preventDefault(){prevented=true;}},item,null),false);
  assert.equal(prevented,true,'unowned/missing WebContents must be cancelled by the integration hook');
  const failedItem=fakeDownload();let adapter;
  const failed=await prepareNativeDownloads({profileRoot,stagingRoot:path.join(profileRoot,'staging'),onDownload:value=>{adapter=value;}});
  assert.equal(failed({preventDefault(){}},failedItem,{id:43}),true);
  const copy=adapter.saveAs(path.join(profileRoot,'should-not-copy.exe'));
  failedItem.emit('done',{},'interrupted');
  await assert.rejects(copy,/interrupted/u);
});

test('native download staging refuses a symlinked directory',async t=>{
  const profileRoot=await mkdtemp(path.join(os.tmpdir(),'k-electron-download-link-'));
  const outside=await mkdtemp(path.join(os.tmpdir(),'k-electron-download-outside-'));
  const stagingRoot=path.join(profileRoot,'staging');
  try{await symlink(outside,stagingRoot,'junction');}catch(error){t.skip(`directory symlinks unavailable: ${error.code??error.message}`);return;}
  await assert.rejects(prepareNativeDownloads({profileRoot,stagingRoot,onDownload:()=>{}}),/link or non-directory/u);
});
