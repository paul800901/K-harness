import {mkdir,writeFile,readFile,rename,stat,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {checkedPath} from './files.mjs';
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const mediaTypes={'.wav':['audio','audio/wav'],'.mp3':['audio','audio/mpeg'],'.m4a':['audio','audio/mp4'],'.mp4':['video','video/mp4']};
const textTypes=new Set(['.txt','.md','.json','.csv','.tsv','.js','.mjs','.ts','.tsx','.jsx','.py','.css','.html','.xml','.yaml','.yml','.log']);
const MAX_OPTIONAL_EXTRACTION_BYTES=32*1024*1024;
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
function validateName(threadId,name){
 if(!validId(threadId)||typeof name!=='string'||name!==path.basename(name)||name.length>180||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/^\.|^(auth|credentials)\.json$/i.test(name))throw new Error('附件名稱無效或可能是秘密檔。');
}
async function saveAttachmentRecord(root,threadId,name,source,{inputModalities=[],stream=null}={}){
 const extension=path.extname(name).toLowerCase();
 const media=mediaTypes[extension],nativePdf=extension==='.pdf'&&inputModalities.includes('pdf');
 const id=randomUUID(),relative=`.runtime/uploads/${id}/source${extension}`,partial=`.runtime/uploads/${id}/source${extension}.partial`,folder=path.join(root,'.runtime/uploads',id),target=path.join(root,relative),partialTarget=path.join(root,partial);
 await mkdir(folder,{recursive:true});
 await checkedPath(root,stream?partial:relative,true);
 let bytes=null,byteCount=0,extracted=null,warning=null;
 if(stream){
  await pipeline(stream,createWriteStream(partialTarget,{flags:'wx'}));
  byteCount=(await stat(partialTarget)).size;
  if(!byteCount)throw new Error('附件不可為空。');
 }else{
  const {base64}=source??{};
  if(typeof base64!=='string'||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('附件編碼無效。');
  bytes=Buffer.from(base64,'base64');if(!bytes.length)throw new Error('附件不可為空。');byteCount=bytes.length;
 }
 const optionalExtraction=(textTypes.has(extension)||extension==='.pdf'&&!nativePdf||extension==='.docx');
 const extractionAvailable=optionalExtraction&&byteCount<=MAX_OPTIONAL_EXTRACTION_BYTES;
 if(optionalExtraction&&!extractionAvailable)warning='原檔已保存；此大檔不預先擷取文字，由原生核心按需讀取。';
 if(textTypes.has(extension)){
  if(extractionAvailable)try{const input=bytes??await readFile(partialTarget);extracted=new TextDecoder('utf-8',{fatal:true}).decode(input);}
  catch{warning='文字擷取失敗；已保留原始附件供原生核心處理。';}
 }
 if(extension==='.pdf'&&!nativePdf&&extractionAvailable){
  try{
   const input=bytes??await readFile(partialTarget);
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const standardFontDataUrl=fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/');
   const loading=getDocument({data:new Uint8Array(input),standardFontDataUrl,isEvalSupported:false,useSystemFonts:false,disableFontFace:true});let doc;
   try{doc=await loading.promise;const pages=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const content=await page.getTextContent();pages.push(`[第 ${i} 頁]\n`+content.items.map(x=>x.str??'').join(' '));}const text=pages.join('\n\n');if(text.replace(/\[第 \d+ 頁\]/g,'').trim().length>=20)extracted=text;warning=extracted?'PDF 目前擷取文字，不保證表格版面與圖片完整。':'PDF 文字擷取未取得足夠文字；已保留原始附件供原生核心處理。';}
   finally{await loading.destroy();}
  }catch{warning='PDF 文字擷取失敗；已保留原始附件供原生核心處理。';}
 }
 if(extension==='.docx'&&extractionAvailable){
  try{const input=bytes??await readFile(partialTarget);const {default:mammoth}=await import('mammoth');const result=await mammoth.extractRawText({buffer:input});extracted=result.value;warning='DOCX 目前擷取文字，不包含內嵌圖片或版面。';}
  catch{warning='DOCX 文字擷取失敗；已保留原始附件供原生核心處理。';}
 }
 if(stream){await checkedPath(root,relative,true);await rename(partialTarget,target);}else await writeFile(target,bytes,{flag:'wx'});
 let textPath;if(extracted!==null){textPath=`.runtime/uploads/${id}/content.txt`;await writeFile(path.join(root,textPath),extracted,{flag:'wx'});}
 const record={id,threadId,name,path:relative,textPath,size:byteCount,contentType:imageTypes[extension]??media?.[1]??(extension==='.pdf'?'application/pdf':'application/octet-stream'),kind:media?.[0]??(imageTypes[extension]?'image':'document'),warning};
 await writeFile(path.join(folder,'attachment.json'),JSON.stringify(record),{flag:'wx'});return record;
}
export async function saveAttachment(root,threadId,data,{inputModalities=[]}={}){
 const {name}=data??{};validateName(threadId,name);return saveAttachmentRecord(root,threadId,name,data,{inputModalities});
}
export async function saveAttachmentStream(root,threadId,{name,stream},{inputModalities=[]}={}){
 validateName(threadId,name);
 if(!stream||typeof stream[Symbol.asyncIterator]!=='function')throw new Error('附件串流無效。');
 return saveAttachmentRecord(root,threadId,name,null,{inputModalities,stream});
}
export async function loadAttachment(root,threadId,id){
 if(!validId(id))throw new Error('附件 ID 無效。');const target=await checkedPath(root,`.runtime/uploads/${id}/attachment.json`,false);const a=JSON.parse(await readFile(target,'utf8'));
 if(a.threadId!==threadId||a.id!==id)throw new Error('不能把其他對話的附件帶入。');
 await checkedPath(root,a.path,false);if(a.textPath)await checkedPath(root,a.textPath,false);return a;
}
export async function readPresentedFile(root,name,{maxBytes}={}){
 const target=await checkedPath(root,name,false);
 let bytes,size;
 if(maxBytes===undefined){bytes=await readFile(target);size=bytes.length;}
 else{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new Error('預覽長度無效。');
  const file=await open(target,'r');
  try{size=(await file.stat()).size;const length=Math.min(size,maxBytes),buffer=Buffer.alloc(length);let offset=0;while(offset<length){const {bytesRead}=await file.read(buffer,offset,length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}bytes=buffer.subarray(0,offset);}
  finally{await file.close();}
 }
 const ext=path.extname(name).toLowerCase();
 return {name:path.basename(name),bytes,...(maxBytes===undefined?{}:{size,truncated:bytes.length<size}),contentType:imageTypes[ext]??mediaTypes[ext]?.[1]??(ext==='.pdf'?'application/pdf':'application/octet-stream'),isText:textTypes.has(ext)};
}
