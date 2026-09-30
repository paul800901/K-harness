import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'descendant.pid'),String(child.pid));
process.stdin.setEncoding('utf8');process.stdin.on('data',()=>console.log(JSON.stringify({type:'error',code:'active-work'})));
setInterval(()=>{},1000);
