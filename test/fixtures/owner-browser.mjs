import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createOwnerBrowserRegistry} from '../../src/owner-browser-registry.mjs';

// Real owner registration and permission modes, without starting a browser.
export async function fixtureBrowser(root,state={available:true,busy:false}){
  const vault=path.join(root,'browser-private'),outputRoot=path.join(root,'browser-output');
  await mkdir(vault);await mkdir(outputRoot);
  const registry=createOwnerBrowserRegistry({vault,outputRoot,gatewayFactory:async()=>({
    aiMcpServer:{url:'http://127.0.0.1:45678/mcp',headers:{Authorization:'Bearer fixture'}},
    async humanRequest(){return Response.json(state);},async close(){},
  })});
  const session=registry.session();
  return {browserConfig:session.config,browserRequest:registry.request,closeBrowser:registry.close};
}
