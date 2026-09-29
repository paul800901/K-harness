// Accept only authorization pages produced by the official Claude CLI.
export function officialClaudeLoginUrl(value){
 if(typeof value!=='string'||/[\x00-\x20\x7f]/.test(value))return null;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
   ['claude.com','claude.ai','platform.claude.com','console.anthropic.com'].includes(url.hostname)&&
   url.pathname.split('/').includes('oauth')?url.href:null;
 }catch{return null;}
}
