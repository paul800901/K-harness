import {readFile,mkdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createExternalBrowserGateway} from './external-browser-gateway.mjs';
import {createChromeExtensionContext} from './chrome-extension-context.mjs';
import {openChromeConnectPageViaNative} from './chrome-native-connection.mjs';

// Trusted owner configuration only, never a model-supplied endpoint or profile.
export async function loadKBrowserAssistant({vault}){
 const file=path.join(vault,'k-browser-assistant.json');
 let config;try{config=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}
 if(config?.enabled!==true||!Object.keys(config).every(key=>['enabled','extensionId','chromeExecutable'].includes(key))||!/^[a-p]{32}$/.test(config.extensionId??'')||!path.isAbsolute(config.chromeExecutable??''))throw Error('K 瀏覽器助手設定無效；沒有退回其他瀏覽器。');
 if(!(await stat(config.chromeExecutable)).isFile())throw Error('Chrome executable unavailable.');
 const root=await realpath(vault),userDataDir=path.join(root,'k-chrome-profile');
 await mkdir(userDataDir,{recursive:true});
 if((await realpath(userDataDir)).toLowerCase()!==userDataDir.toLowerCase())throw Error('Chrome profile cannot redirect outside the owner vault.');
 // User input elsewhere on the computer is not a browser stop command.
 return options=>createExternalBrowserGateway({...options,launchExternalContext:({mode})=>
  createChromeExtensionContext({mode,extensionId:config.extensionId,openConnectPage:url=>openChromeConnectPageViaNative({descriptorPath:path.join(root,'k-browser-native-link.json')},url)})});
}

