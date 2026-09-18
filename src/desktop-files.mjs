import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkedPath} from './files.mjs';
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const textTypes=new Set(['.txt','.md','.json','.csv','.tsv','.js','.mjs','.ts','.tsx','.jsx','.py','.css','.html','.xml','.yaml','.yml','.log']);
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
export async function saveAttachment(root,threadId,{name,base64}){
 if(!validId(threadId)||typeof name!=='string'||name!==path.basename(name)||name.length>180||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/^\.|^(auth|credentials)\.json$/i.test(name))throw new Error('附件名稱無效或可能是秘密檔。');
 const extension=path.extname(name).toLowerCase();
 if(!imageTypes[extension]&&!textTypes.has(extension)&&!['.pdf','.docx'].includes(extension))throw new Error('支援文字、程式碼、CSV、PDF、DOCX、PNG、JPEG 與 WebP；不會假裝讀取其他格式。');
 if(typeof base64!=='string'||base64.length>12*1024*1024||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('附件編碼或大小無效。');
 const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>8*1024*1024)throw new Error('每個附件須為 1 byte 至 8 MB。');
 let extracted=null,warning=null;
 if(textTypes.has(extension)){if(bytes.length>256*1024)throw new Error('純文字附件上限 256 KiB。');try{extracted=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('文字附件必須為 UTF-8。');}}
 if(extension==='.pdf'){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl=fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/');
  const loading=getDocument({data:new Uint8Array(bytes),standardFontDataUrl,isEvalSupported:false,useSystemFonts:false,disableFontFace:true});let doc;
  try{doc=await loading.promise;if(doc.numPages>60)throw new Error('目前 PDF 上限 60 頁。');const pages=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const content=await page.getTextContent();pages.push(`[第 ${i} 頁]\n`+content.items.map(x=>x.str??'').join(' '));}extracted=pages.join('\n\n');if(extracted.replace(/\[第 \d+ 頁\]/g,'').trim().length<20)throw new Error('這份 PDF 沒有足夠可讀文字，可能是掃描檔；請改傳頁面圖片。');warning='PDF 目前擷取文字，不保證表格版面與圖片完整。';}
  finally{await loading.destroy();}
 }
 if(extension==='.docx'){const {default:mammoth}=await import('mammoth');const result=await mammoth.extractRawText({buffer:bytes});extracted=result.value;warning='DOCX 目前擷取文字，不包含內嵌圖片或版面。';}
 if(extracted!==null&&Buffer.byteLength(extracted)>256*1024)throw new Error('擷取文字超過 256 KiB，請分段後上傳。');
 const id=randomUUID(),relative=`.runtime/uploads/${id}/source${extension}`,folder=path.join(root,'.runtime/uploads',id);await mkdir(folder,{recursive:true});
 await checkedPath(root,relative,true);await writeFile(path.join(root,relative),bytes,{flag:'wx'});
 let textPath;if(extracted!==null){textPath=`.runtime/uploads/${id}/content.txt`;await writeFile(path.join(root,textPath),extracted,{flag:'wx'});}
 const record={id,threadId,name,path:relative,textPath,size:bytes.length,contentType:imageTypes[extension]??'application/octet-stream',kind:imageTypes[extension]?'image':'document',warning};
 await writeFile(path.join(folder,'attachment.json'),JSON.stringify(record),{flag:'wx'});return record;
}
export async function loadAttachment(root,threadId,id){
 if(!validId(id))throw new Error('附件 ID 無效。');const target=await checkedPath(root,`.runtime/uploads/${id}/attachment.json`,false);const a=JSON.parse(await readFile(target,'utf8'));
 if(a.threadId!==threadId||a.id!==id)throw new Error('不能把其他對話的附件帶入。');
 await checkedPath(root,a.path,false);if(a.textPath)await checkedPath(root,a.textPath,false);return a;
}
export async function readPresentedFile(root,name){
 const target=await checkedPath(root,name,false);const info=await stat(target);if(info.size>8*1024*1024)throw new Error('預覽／下載上限 8 MB。');
 const bytes=await readFile(target);const ext=path.extname(name).toLowerCase();
 return {name:path.basename(name),bytes,contentType:imageTypes[ext]??'application/octet-stream',isText:textTypes.has(ext)};
}
