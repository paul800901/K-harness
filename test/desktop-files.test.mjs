import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {saveAttachment,loadAttachment,readPresentedFile} from '../src/desktop-files.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
async function fixture(){const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'attachments-'));}
const upload=(root,name,bytes)=>saveAttachment(root,'thread-a',{name,base64:Buffer.from(bytes).toString('base64')});

test('attachments preserve original bytes, extract UTF-8, and reject cross-thread/path/unsupported input',async()=>{
 const root=await fixture(),bytes=Buffer.from('\ufeff名稱,數量\r\n蘋果,7\r\n');
 const a=await upload(root,'content.txt',bytes);assert.deepEqual(await readFile(path.join(root,a.path)),bytes);
 assert.match(await readFile(path.join(root,a.textPath),'utf8'),/蘋果,7/);
 assert.equal((await loadAttachment(root,'thread-a',a.id)).name,'content.txt');
 await assert.rejects(loadAttachment(root,'thread-b',a.id));await assert.rejects(loadAttachment(root,'thread-a','../outside'));
 for(const name of ['../secret.txt','.env.local','auth.json','file.exe'])await assert.rejects(upload(root,name,'no'));
 await assert.rejects(upload(root,'invalid.txt',Buffer.from([0xff,0xfe])));
 for(const base64 of ['', 'invalid!', 'YQ='])await assert.rejects(saveAttachment(root,'thread-a',{name:'bad.txt',base64}));
 assert.equal((await readPresentedFile(root,a.path)).isText,true);
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
  upload:data=>saveAttachment(root,'thread-a',data),attachmentFile:async id=>{const a=await loadAttachment(root,'thread-a',id);return {...await readPresentedFile(root,a.path),name:a.name};}
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
