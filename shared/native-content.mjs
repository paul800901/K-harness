// Preserve native destinations. Classification chooses presentation, not tool permissions.
export function nativeDestinationKind(value){
 const href=String(value??'');let decoded=href;try{decoded=decodeURIComponent(href);}catch{}
 if(!href)return 'empty';
 if(/^(?:[a-z]:[\\/]|\\\\|file:)/iu.test(decoded))return 'file';
 if(/^https?:\/\//iu.test(href)||href.startsWith('//'))return 'web';
 if(/^(?:mailto|tel):/iu.test(href))return 'external';
 if(href.startsWith('#'))return 'fragment';
 if(/^[a-z][a-z\d+.-]*:/iu.test(href))return 'other';
 return 'file';
}

export const preserveNativeUrl=value=>value;

// CommonMark treats a Windows backslash before '.' as an escape. Recover the
// destination from its native source span before it reaches the HTML renderer.
export function restoreNativeFileDestinations(){
 return (tree,file)=>{
  const source=String(file.value??'');
  const visit=node=>{
   if(['link','image','definition'].includes(node.type)&&node.position){
    const raw=source.slice(node.position.start.offset,node.position.end.offset);
    const body=node.type==='definition'?raw.replace(/^\s*\[[^\]]+\]:\s*/u,''):raw.slice(raw.lastIndexOf('](')+2,-1).trim();
    const match=body.match(/^(?:<([^>]+)>|(\S+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/u);
    const href=match?.[1]??match?.[2];
    if(href?.includes('\\')&&nativeDestinationKind(href)==='file'&&href.replace(/\\([!-/:-@[-`{-~])/gu,'$1')===node.url)node.url=href;
   }
   for(const child of node.children??[])visit(child);
  };
  visit(tree);
 };
}

export function messageFileUrl(href,threadId,download=false){
 return `/api/message-file?path=${encodeURIComponent(href)}&threadId=${encodeURIComponent(threadId??'')}${download?'&download=1':''}`;
}

// A file request must name a destination actually emitted in this conversation.
// Do not let an authenticated query become an arbitrary filesystem read.
export function referencesNativeDestination(messages,href){
 const candidates=[href];try{candidates.push(decodeURI(href),decodeURIComponent(href));}catch{}
 return messages?.some(message=>message.role==='assistant'&&candidates.some(value=>{
  const text=message.text??'';
  return text.includes(`](${value})`)||text.includes(`](<${value}>)`)||
   text.includes(`](${value} (`)||text.includes(`](<${value}> (`)||text.includes(`](${value} "`)||text.includes(`](${value} '` )||text.includes(`](<${value}> "`)||text.includes(`](<${value}> '` )||
   text.split(/\r?\n/u).some(line=>/^\s*\[[^\]]+\]:\s*/u.test(line)&&
    [value,`<${value}>`].some(destination=>{const body=line.replace(/^\s*\[[^\]]+\]:\s*/u,'');return body===destination||body.startsWith(destination+' "')||body.startsWith(destination+" '")||body.startsWith(destination+' (');}));
 }))??false;
}
