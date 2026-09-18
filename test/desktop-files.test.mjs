import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {saveAttachment,loadAttachment,readPresentedFile} from '../src/desktop-files.mjs';
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
 await assert.rejects(upload(root,'large.txt',Buffer.alloc(262145,65)));
 assert.equal((await readPresentedFile(root,a.path)).isText,true);
});

test('DOCX attachment has real text extraction and original download bytes',async()=>{
 const root=await fixture(),zip=new JSZip();
 zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>K DOCX synthetic acceptance 7 + 12 = 19.</w:t></w:r></w:p></w:body></w:document>');
 const bytes=await zip.generateAsync({type:'nodebuffer'});const a=await upload(root,'驗收.docx',bytes);
 assert.match(await readFile(path.join(root,a.textPath),'utf8'),/7 \+ 12 = 19/);assert.deepEqual(await readFile(path.join(root,a.path)),bytes);assert.match(a.warning,/不包含/);
});

test('PDF attachment extracts actual page text and reports format limitations',async()=>{
 const root=await fixture();const stream='BT /F1 12 Tf 40 100 Td (K PDF synthetic acceptance: 7 plus 12 equals 19.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const start=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 const a=await upload(root,'驗收.pdf',pdf);assert.match(await readFile(path.join(root,a.textPath),'utf8'),/7 plus 12 equals 19/);assert.match(a.warning,/不保證/);
});
