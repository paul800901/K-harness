// Explicit, local engineering entry. Does not install/configure Tailscale or start K.
import path from 'node:path';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseArgs} from 'node:util';
import {validateRemoteConfig,remoteKeyHash} from '../src/remote-access.mjs';
const {values}=parseArgs({options:{root:{type:'string'},origin:{type:'string'},login:{type:'string'},port:{type:'string',default:'47832'},revoke:{type:'boolean'},rotate:{type:'boolean'}}});
if(!values.root||!path.isAbsolute(values.root))throw Error('請明確指定 K 的 state root 絕對路徑；不是程式目錄。');
await access(values.root);
const file=path.join(values.root,'.local','remote-access.json');
await mkdir(path.dirname(file),{recursive:true});
if(values.revoke){
 await writeFile(file,JSON.stringify({enabled:false})+'\n');
 console.log('已撤銷全部遠端存取；現有串流最遲於下一次心跳關閉。原生工作不會停止或重送。');
}else{
 let exists=false;try{await access(file);exists=true;}catch{}
 if(exists&&!values.rotate)throw Error('設定已存在；要撤銷舊金鑰並重建，請明確使用 --rotate。');
 const key=randomBytes(32).toString('base64url');
 const config={enabled:true,origin:values.origin,login:values.login,port:Number(values.port),keyHash:remoteKeyHash(key)};
 // Validate before touching the existing configuration.
 validateRemoteConfig(config);
 await writeFile(file,JSON.stringify(config,null,2)+'\n');
 console.log(`已建立設定；K 下次完整啟動才會開啟 loopback 遠端入口。\n私人網址：${config.origin}\n存取金鑰（僅顯示這一次，勿放入 Git／聊天／命令列）：${key}\n僅可使用 Tailscale Serve → http://127.0.0.1:${config.port}，不可使用 Funnel。`);
}
