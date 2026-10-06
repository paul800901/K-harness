import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {saveAttachment,loadAttachment,readPresentedFile} from '../src/desktop-files.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {createGeminiController} from '../src/gemini-controller.mjs';

const modalities=['text','image','pdf','audio','video'];
async function fixture(){const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'gemini-media-'));}
function pdfBytes(count=1){
 const stream='1 0 0 rg 20 20 100 100 re f';
 const pages=Array.from({length:count},(_,i)=>i+3),objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map(id=>`${id} 0 R`).join(' ')}] /Count ${count} >>`,...pages.map(() =>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents ${count+3} 0 R >>`),`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const size=objects.length+1,start=Buffer.byteLength(pdf);return Buffer.from(pdf+`xref\n0 ${size}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
}
test('native PDF preserves original visuals beyond the former 60-page cap; ordinary extraction remains explicit',async()=>{
 const root=await fixture(),bytes=pdfBytes(),data={name:'scan.pdf',base64:bytes.toString('base64')};
 const fallback=await saveAttachment(root,'a',data);assert.equal(fallback.textPath,undefined);assert.match(fallback.warning,/保留原始附件/);assert.deepEqual(await readFile(path.join(root,fallback.path)),bytes);
 const item=await saveAttachment(root,'a',data,{inputModalities:modalities});
 assert.equal(item.textPath,undefined);assert.equal(item.warning,null);assert.deepEqual(await readFile(path.join(root,item.path)),bytes);
 assert.equal((await readPresentedFile(root,item.path)).contentType,'application/pdf');
 const many=pdfBytes(61),manyItem=await saveAttachment(root,'a',{...data,base64:many.toString('base64')},{inputModalities:modalities});
 assert.deepEqual((await readPresentedFile(root,manyItem.path)).bytes,many);
 const corrupt=await saveAttachment(root,'a',{...data,base64:Buffer.from('not a PDF').toString('base64')});assert.match(corrupt.warning,/保留原始附件/);assert.deepEqual(await readFile(path.join(root,corrupt.path)),Buffer.from('not a PDF'));
});
test('audio/video and unknown files are preserved without modality whitelists and remain conversation-owned',async()=>{
 const root=await fixture();for(const [ext,kind] of [['wav','audio'],['mp3','audio'],['m4a','audio'],['mp4','video']]){
  const bytes=ext==='wav'?Buffer.alloc(10*1024*1024,65):Buffer.from('unit fixture: transport only, not media acceptance'),data={name:`file.${ext}`,base64:bytes.toString('base64')};
  const item=await saveAttachment(root,'a',data);assert.equal(item.kind,kind);assert.equal(item.textPath,undefined);
  assert.deepEqual((await readPresentedFile(root,item.path)).bytes,bytes);assert.equal((await loadAttachment(root,'a',item.id)).name,data.name);
  await assert.rejects(loadAttachment(root,'b',item.id),/其他對話/);
 }
});
test('Gemini generic media uses original paths after model change without claiming verified modality support',async()=>{
 const root=await fixture(),calls=[];let done;
 const c=createGeminiController({root,executable:path.join(root,'fake-agy.exe'),loginFactory:()=>({status:async()=>({available:true,models:['gemini-3.1-pro-low','gemini-unknown-low']})}),
  run:async(_b,args,{onChunk})=>{calls.push(args);onChunk(Buffer.from(JSON.stringify({event:'init',conversation_id:'11111111-1111-4111-8111-111111111111'})+'\n'+JSON.stringify({event:'result',result:{status:'SUCCESS',response:'transport test'}})+'\n'));return {code:0};},onChange:s=>{if(s&&!s.busy)done?.();}});
 try{
  const {threadId}=await c.open({model:'gemini-3.1-pro',effort:'low'});
  const pdf=await c.upload({threadId,name:'page.pdf',base64:pdfBytes().toString('base64')}),audio=await c.upload({threadId,name:'voice.wav',base64:Buffer.from('fixture').toString('base64')});
  // A pre-upgrade PDF may have a text companion. Gemini must still use the original.
  const legacy={...pdf,textPath:pdf.path.replace('source.pdf','content.txt')};await writeFile(path.join(root,legacy.textPath),'legacy text');
  await writeFile(path.join(root,'.runtime/uploads',pdf.id,'attachment.json'),JSON.stringify(legacy));
  const settled=new Promise(resolve=>{done=resolve;});await c.send({text:'inspect',attachmentIds:[pdf.id,audio.id]});await settled;
  const prompt=calls[0][1];assert.ok(prompt.includes('source.pdf'));assert.ok(prompt.includes('source.wav'));assert.ok(!prompt.includes('content.txt'));
  assert.ok(prompt.includes(path.resolve(root,pdf.path).replaceAll('\\','\\\\')));assert.ok(prompt.includes(path.resolve(root,audio.path).replaceAll('\\','\\\\')));
  await c.selectModel({threadId,model:'gemini-unknown',effort:'low'});
  const next=new Promise(resolve=>{done=resolve;});await c.send({text:'native generic path only',attachmentIds:[audio.id]});await next;assert.equal(calls.length,2);assert.ok(calls[1][1].includes('source.wav'));
  const scan=await c.upload({threadId,name:'unreadable.pdf',base64:Buffer.from('synthetic unreadable PDF').toString('base64')});assert.ok(scan.warning);
  const final=new Promise(resolve=>{done=resolve;});await c.send({text:'path and warning only',attachmentIds:[scan.id]});await final;
  assert.equal(calls.length,3);assert.ok(calls[2][1].includes(path.resolve(root,scan.path).replaceAll('\\','\\\\')));assert.ok(calls[2][1].includes(scan.warning));
  const video=await c.upload({threadId,name:'new.mp4',base64:Buffer.from('fake').toString('base64')});assert.equal(video.kind,'video');
 }finally{await c.close();}
});


test('PDF and media HTTP downloads retain attachment disposition, MIME and exact bytes',async()=>{
 const root=await fixture();let item;
 const app=await startDesktop({root,port:0,controllerFactory:()=>({state:{threadId:'a'},close:async()=>{},attachmentFile:async()=>({...await readPresentedFile(root,item.path),name:item.name}),attachmentSource:async()=>({name:item.name,path:path.join(root,item.path),size:item.size,contentType:item.contentType})})});
 try{
  const bootstrap=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=bootstrap.headers.get('set-cookie').split(';')[0];
  for(const name of ['page.pdf','sound.wav','sound.mp3','sound.m4a','clip.mp4']){
   const bytes=name.endsWith('.pdf')?pdfBytes():Buffer.from('HTTP transport fixture');
   item=await saveAttachment(root,'a',{name,base64:bytes.toString('base64')},{inputModalities:modalities});
   const response=await fetch(app.origin+'/api/attachment?id='+item.id+'&download=1',{headers:{cookie}});
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),item.contentType);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
   const preview=await fetch(app.origin+'/api/attachment?id='+item.id,{headers:{cookie}});assert.equal(preview.headers.get('content-type'),'application/json; charset=utf-8');assert.equal((await preview.json()).isText,false);
  }
 }finally{await app.close();}
});
