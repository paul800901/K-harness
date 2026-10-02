// Accept only the official Codex ChatGPT authorization page.
export function officialCodexLoginUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='auth.openai.com'&&!url.username&&!url.password&&!url.port&&url.pathname==='/oauth/authorize'?url.href:null;}catch{return null;}
}
