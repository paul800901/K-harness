import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {remoteLoginHtml,remoteLoginJs} from '../src/remote-access.mjs';

async function submit(value,response){
 let handler,request,replaced=null;
 const button={disabled:false},alert={textContent:''};
 const form={addEventListener:(_,fn)=>{handler=fn;},querySelector:s=>s==='button'?button:alert};
 vm.runInNewContext(remoteLoginJs,{document:{querySelector:s=>s==='form'?form:{value}},fetch:async(url,options)=>{request={url,...options};if(response instanceof Error)throw response;return response;},location:{replace:url=>{replaced=url;}}});
 await handler({preventDefault(){},target:form});
 return {request,button,alert,replaced};
}

test('remote login explains key versus identity versus transport failures without replaying',async()=>{
 for(const [reason,expected]of [['Remote access denied',/金鑰不正確/],['Invalid remote identity or host',/身分或網址未獲允許/],['Explicit same-origin request required',/登入請求遭拒/]]){
  const result=await submit('wrong',{ok:false,json:async()=>({error:reason})});
  assert.match(result.alert.textContent,expected);assert.equal(result.replaced,null);assert.equal(result.button.disabled,false);
 }
 const network=await submit('test',Error('socket closed'));
 assert.match(network.alert.textContent,/尚未確認登入結果/);assert.equal(network.replaced,null);assert.equal(network.button.disabled,false);
 const nonJson=await submit('test',{ok:false,json:async()=>{throw Error('not JSON');}});
 assert.match(nonJson.alert.textContent,/電腦未能完成登入/);
});

test('remote login trims only surrounding paste whitespace and leaves key content unchanged',async()=>{
 const result=await submit(' \n actual-Test_Key \r\n',{ok:true});
 assert.deepEqual(JSON.parse(result.request.body),{key:'actual-Test_Key'});assert.equal(result.replaced,'/');
 const quoted=await submit('"actual-Test_Key"',{ok:false,json:async()=>({error:'Remote access denied'})});
 assert.equal(JSON.parse(quoted.request.body).key,'"actual-Test_Key"');assert.match(quoted.alert.textContent,/金鑰不正確/);
 assert.match(remoteLoginHtml,/autocapitalize="none"/);assert.match(remoteLoginHtml,/spellcheck="false"/);
});
