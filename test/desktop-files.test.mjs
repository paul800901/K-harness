import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createReadStream} from 'node:fs';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {saveAttachment,saveAttachmentStream,loadAttachment,readPresentedFile} from '../src/desktop-files.mjs';
import {sessionAttachmentSource} from '../src/session-workspace.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
async function fixture(){const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'attachments-'));}
const upload=(root,name,bytes)=>saveAttachment(root,'thread-a',{name,base64:Buffer.from(bytes).toString('base64')});

test('attachments preserve original bytes, extract UTF-8, and reject cross-thread/path/secret names',async()=>{
 const root=await fixture(),bytes=Buffer.from('\ufeff名稱,數量\r\n蘋果,7\r\n');
 const a=await upload(root,'content.txt',bytes);assert.deepEqual(await readFile(path.join(root,a.path)),bytes);
 assert.match(await readFile(path.join(root,a.textPath),'utf8'),/蘋果,7/);
 assert.equal((await loadAttachment(root,'thread-a',a.id)).name,'content.txt');
 await assert.rejects(loadAttachment(root,'thread-b',a.id));await assert.rejects(loadAttachment(root,'thread-a','../outside'));
 for(const name of ['../secret.txt','.env.local','auth.json'])await assert.rejects(upload(root,name,'no'));
 const invalid=await upload(root,'invalid.txt',Buffer.from([0xff,0xfe]));assert.match(invalid.warning,/保留原始附件/);assert.deepEqual(await readFile(path.join(root,invalid.path)),Buffer.from([0xff,0xfe]));
 for(const base64 of ['', 'invalid!', 'YQ='])await assert.rejects(saveAttachment(root,'thread-a',{name:'bad.txt',base64}));
 assert.equal((await readPresentedFile(root,a.path)).isText,true);
});

test('raw media and unknown extensions stream to original-path records without modality gates or Base64',async()=>{
 const root=await fixture();
 for(const name of ['recording.m4a','camera.mp4','flight.LRF','unknown.bin']){
  const bytes=Buffer.from(`synthetic:${name}`),record=await saveAttachmentStream(root,'thread-stream',{name,stream:Readable.from([bytes])});
  assert.equal(record.size,bytes.length);assert.equal(record.threadId,'thread-stream');assert.equal(record.name,name);
  assert.deepEqual(await readFile(path.join(root,record.path)),bytes);assert.equal(record.textPath,undefined);
 }
 await assert.rejects(saveAttachmentStream(root,'thread-stream',{name:'bad.m4a',stream:Readable.from([])}),/不可為空/);
 await assert.rejects(loadAttachment(root,'other-thread',(await saveAttachmentStream(root,'thread-stream',{name:'same.m4a',stream:Readable.from(['x'])})).id),/其他對話/);
});

test('optional text extraction skips files above 32 MiB without limiting the original stream',async()=>{
 const root=await fixture(),chunk=Buffer.alloc(1024*1024,0x71),size=32*1024*1024+17,expected=createHash('sha256');
 for(let left=size;left>0;){const length=Math.min(left,chunk.length);expected.update(chunk.subarray(0,length));left-=length;}
 const expectedHash=expected.digest('hex');
 async function* content(){for(let left=size;left>0;){const length=Math.min(left,chunk.length);yield length===chunk.length?chunk:chunk.subarray(0,length);left-=length;}}
 const record=await saveAttachmentStream(root,'thread-large',{name:'large-notes.txt',stream:Readable.from(content())});
 assert.equal(record.size,size);assert.equal(record.textPath,undefined);assert.match(record.warning,/原檔已保存.*不預先擷取文字/);
 const hash=createHash('sha256');let received=0;for await(const part of createReadStream(path.join(root,record.path))){received+=part.length;hash.update(part);}
 assert.equal(received,size);assert.equal(hash.digest('hex'),expectedHash);
 assert.equal((await loadAttachment(root,'thread-large',record.id)).path,record.path);
});

test('bounded presented-file reads return only the requested preview bytes and full file size',async()=>{
 const root=await fixture(),text='A'.repeat(24*1024),record=await saveAttachmentStream(root,'thread-preview',{name:'preview.txt',stream:Readable.from([Buffer.from(text)])});
 const preview=await readPresentedFile(root,record.textPath,{maxBytes:4096});
 assert.equal(preview.bytes.length,4096);assert.equal(preview.size,Buffer.byteLength(text));assert.equal(preview.truncated,true);
 assert.equal(preview.bytes.toString('utf8'),'A'.repeat(4096));
 await assert.rejects(readPresentedFile(root,record.textPath,{maxBytes:-1}),/預覽長度無效/);
});

test('extraction failure keeps original PDF and DOCX and records a warning',async()=>{
 const root=await fixture();
 for(const [name,bytes] of [['bad.pdf',Buffer.from('not a pdf')],['bad.docx',Buffer.from('not a zip')]]){
  const record=await saveAttachmentStream(root,'thread-extract',{name,stream:Readable.from([bytes])});
  assert.match(record.warning,/失敗/);assert.equal(record.textPath,undefined);assert.deepEqual(await readFile(path.join(root,record.path)),bytes);
 }
});

test('an interrupted raw stream never creates an attachment record',async()=>{
 const root=await fixture(),before=new Set(await readdir(path.join(root,'.runtime/uploads')).catch(()=>[]));
 async function* broken(){yield Buffer.from('partial fixture');throw new Error('synthetic disconnect');}
 await assert.rejects(saveAttachmentStream(root,'thread-a',{name:'disconnect.m4a',stream:Readable.from(broken())}),/synthetic disconnect/);
 const folder=(await readdir(path.join(root,'.runtime/uploads'))).find(name=>!before.has(name));assert.ok(folder);
 await assert.rejects(readFile(path.join(root,'.runtime/uploads',folder,'attachment.json')));
 assert.ok(Buffer.isBuffer(await readFile(path.join(root,'.runtime/uploads',folder,'source.m4a.partial'))));
});

test('DOCX attachment has real text extraction and original download bytes',async()=>{
 const root=await fixture(),zip=new JSZip();
 const text='K DOCX synthetic acceptance 7 + 12 = 19. '.repeat(8000);
 zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('word/document.xml',`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
 const bytes=await zip.generateAsync({type:'nodebuffer'});const a=await upload(root,'驗收.docx',bytes);
 assert.match(await readFile(path.join(root,a.textPath),'utf8'),/7 \+ 12 = 19/);assert.deepEqual(await readFile(path.join(root,a.path)),bytes);assert.match(a.warning,/不包含/);
 assert.equal((await readFile(path.join(root,a.textPath),'utf8')).trim(),text.trim());assert(a.size>256*1024);
});

test('PDF text extraction preserves all 61 pages and more than 256 KiB of text',async()=>{
 const root=await fixture(),text='K PDF synthetic acceptance: 7 plus 12 equals 19. '.repeat(110),stream=`BT /F1 1 Tf 40 100 Td (${text}) Tj ET`;
 const pages=Array.from({length:61},(_,i)=>i+3),font=64,content=65;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map(id=>`${id} 0 R`).join(' ')}] /Count 61 >>`,...pages.map(()=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 4000 200] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const start=Buffer.byteLength(pdf),size=objects.length+1;pdf+=`xref\n0 ${size}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 const a=await upload(root,'驗收.pdf',pdf),extracted=await readFile(path.join(root,a.textPath),'utf8');
 assert.match(extracted,/7 plus 12 equals 19/);assert.match(extracted,/\[第 61 頁\]/);assert.equal((extracted.match(/\[第 \d+ 頁\]/g)||[]).length,61);assert(Buffer.byteLength(extracted)>256*1024);assert.match(a.warning,/不保證/);
});

test('large attachments cross the real HTTP upload, compact preview and full download without K size caps',async()=>{
 const root=await fixture(),bytes=Buffer.from('FAKE_LARGE_ATTACHMENT_BEGIN\n'+'x'.repeat(10*1024*1024)+'\nFAKE_LARGE_ATTACHMENT_END');
 const app=await startDesktop({root,port:0,controllerFactory:()=>({state:{threadId:'thread-a'},close:async()=>{},
  upload:data=>saveAttachment(root,'thread-a',data),attachmentFile:async id=>{const a=await loadAttachment(root,'thread-a',id);return {...await readPresentedFile(root,a.path),name:a.name};},
  attachmentSource:async id=>{const a=await loadAttachment(root,'thread-a',id);return {name:a.name,path:path.join(root,a.path),size:a.size,contentType:a.contentType};}
 })});
 try{
  const launch=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=launch.headers.get('set-cookie').split(';')[0],headers={cookie,'x-k-request':'1','content-type':'application/json'};
  const body=JSON.stringify({threadId:'thread-a',name:'大附件假資料.txt',base64:bytes.toString('base64')});assert(Buffer.byteLength(body)>12*1024*1024);
  const uploaded=await fetch(app.origin+'/api/upload',{method:'POST',headers,body});assert.equal(uploaded.status,200);const a=await uploaded.json();assert.equal(a.size,bytes.length);
  assert.deepEqual(await readFile(path.join(root,a.path)),bytes);assert.deepEqual(await readFile(path.join(root,a.textPath)),bytes);
  const preview=await fetch(app.origin+'/api/attachment?id='+a.id,{headers:{cookie}}),view=await preview.json();assert.equal(view.truncated,true);assert.equal(view.size,bytes.length);assert.equal(view.text.length,262144);
  const download=await fetch(app.origin+'/api/attachment?id='+a.id+'&download=1',{headers:{cookie}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  await assert.rejects(loadAttachment(root,'foreign-thread',a.id),/其他對話/);
  const unauth=await fetch(app.origin+'/api/upload',{method:'POST',headers:{'content-type':'application/json','x-k-request':'1'},body:'{}'});assert.equal(unauth.status,403);
  const crossOrigin=await fetch(app.origin+'/api/upload',{method:'POST',headers:{...headers,origin:'https://untrusted.example'},body:'{}'});assert.equal(crossOrigin.status,403);
  const other=await fetch(app.origin+'/api/metadata',{method:'POST',headers,body:JSON.stringify({text:'x'.repeat(65536)})});assert.equal(other.status,400);assert.match((await other.json()).error,/請求過大/);
 }finally{await app.close();}
});

test('binary HTTP upload checks local auth, CSRF and origin before streaming and stores without a JSON body',async()=>{
 const root=await fixture();let reached=0;
 const app=await startDesktop({root,port:0,controllerFactory:()=>({state:{threadId:'thread-a'},close:async()=>{},
  uploadStream:(data,stream)=>{reached++;return saveAttachmentStream(root,data.threadId,{name:data.name,stream});}
 }),claudeLoginFactory:()=>({close:async()=>{}}),codexLoginFactory:()=>({close:async()=>{}}),geminiLoginFactory:()=>({close:async()=>{}}),localDictationFactory:()=>({close:async()=>{},transcribe:async()=>({})})});
 try{
  const boot=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=boot.headers.get('set-cookie').split(';')[0];
  const bytes=Buffer.from('raw binary fixture\0\xff');
  const headers={cookie,'x-k-request':'1','x-k-command':randomUUID(),'x-k-thread-id':'thread-a','x-k-file-name':encodeURIComponent('flight.LRF'),'content-type':'application/octet-stream'};
  const unauth=await fetch(app.origin+'/api/upload',{method:'POST',headers:{...headers,cookie:''},body:bytes});assert.equal(unauth.status,403);assert.equal(reached,0);
  const noCsrf=await fetch(app.origin+'/api/upload',{method:'POST',headers:{...headers,'x-k-request':''},body:bytes});assert.equal(noCsrf.status,403);assert.equal(reached,0);
  const crossOrigin=await fetch(app.origin+'/api/upload',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:bytes});assert.equal(crossOrigin.status,403);assert.equal(reached,0);
  const uploaded=await fetch(app.origin+'/api/upload',{method:'POST',headers,body:bytes});assert.equal(uploaded.status,200);const record=await uploaded.json();
  assert.equal(reached,1);assert.equal(record.name,'flight.LRF');assert.equal(record.kind,'document');assert.deepEqual(await readFile(path.join(root,record.path)),bytes);
 }finally{await app.close();}
});

test('HTTP stream upload is stored and downloaded by path with matching full-file hash',async()=>{
 const root=await fixture(),chunk=Buffer.alloc(1024*1024,0x73),byteCount=16*1024*1024+123,expectedHash=createHash('sha256');
 for(let left=byteCount;left>0;){const size=Math.min(left,chunk.length);expectedHash.update(size===chunk.length?chunk:chunk.subarray(0,size));left-=size;}
 const expected=expectedHash.digest('hex');
 const app=await startDesktop({root,port:0,controllerFactory:()=>({state:{threadId:'thread-stream'},close:async()=>{},
  uploadStream:(data,stream)=>saveAttachmentStream(root,data.threadId,{name:data.name,stream}),
  attachmentSource:(id,context)=>sessionAttachmentSource(root,[],context.threadId,id)
 }),claudeLoginFactory:()=>({close:async()=>{}}),codexLoginFactory:()=>({close:async()=>{}}),geminiLoginFactory:()=>({close:async()=>{}}),localDictationFactory:()=>({close:async()=>{},transcribe:async()=>({})})});
 try{
  const boot=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=boot.headers.get('set-cookie').split(';')[0];
  const headers={cookie,'x-k-request':'1','x-k-command':randomUUID(),'x-k-thread-id':'thread-stream','x-k-file-name':encodeURIComponent('medium.LRF'),'content-type':'application/octet-stream','content-length':String(byteCount)};
  const req=http.request(new URL('/api/upload',app.origin),{method:'POST',headers}),uploadReply=new Promise((resolve,reject)=>{req.on('response',res=>{let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);});
  async function* input(){for(let left=byteCount;left>0;){const size=Math.min(left,chunk.length);yield size===chunk.length?chunk:chunk.subarray(0,size);left-=size;}}
  await pipeline(Readable.from(input()),req);const uploaded=await uploadReply;assert.equal(uploaded.status,200,uploaded.body);const record=JSON.parse(uploaded.body);
  assert.equal(record.name,'medium.LRF');assert.equal(record.threadId,'thread-stream');assert.equal(record.size,byteCount);
  const stored=createHash('sha256');let storedBytes=0;for await(const part of createReadStream(path.join(root,record.path))){storedBytes+=part.length;stored.update(part);}
  assert.equal(storedBytes,byteCount);assert.equal(stored.digest('hex'),expected);
  const download=await fetch(`${app.origin}/api/attachment?id=${record.id}&threadId=thread-stream&download=1`,{headers:{cookie}});
  assert.equal(download.status,200);assert.equal(download.headers.get('content-length'),String(byteCount));assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8''medium.LRF/);
  assert.equal(download.headers.get('content-type'),'application/octet-stream');const received=createHash('sha256');let receivedBytes=0;
  for await(const part of download.body){receivedBytes+=part.length;received.update(part);}
  assert.equal(receivedBytes,byteCount);assert.equal(received.digest('hex'),expected);
  assert.equal((await fetch(`${app.origin}/api/attachment?id=${record.id}&threadId=wrong-thread&download=1`,{headers:{cookie}})).status,400);
 }finally{await app.close();}
});
