import {StringDecoder} from 'node:string_decoder';

// Native stdio JSONL is delimited by LF, not readline's additional Unicode
// line separators. Decode across byte chunks without splitting JSON strings.
export function readNativeJsonl(input,onLine){
 const decoder=new StringDecoder('utf8');
 let fragments=[],closed=false;
 const emit=()=>{
  let line=fragments.join('');fragments=[];
  if(line.endsWith('\r'))line=line.slice(0,-1);
  onLine(line);
 };
 const consume=text=>{
  let start=0,index;
  while(!closed&&(index=text.indexOf('\n',start))!==-1){
   fragments.push(text.slice(start,index));emit();start=index+1;
  }
  if(!closed&&start<text.length)fragments.push(text.slice(start));
 };
 const data=chunk=>consume(typeof chunk==='string'?chunk:decoder.write(chunk));
 const close=()=>{
  if(closed)return;
  closed=true;fragments=[];
  input.off('data',data);input.off('end',end);
 };
 const end=()=>{
  consume(decoder.end());
  if(!closed&&fragments.length)emit();
  close();
 };
 input.on('data',data);input.once('end',end);
 return {close};
}
