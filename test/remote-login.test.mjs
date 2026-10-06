import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {remoteLoginHtml,remoteLoginJs} from '../src/remote-access.mjs';

async function submit(value,response){
 let handler,request,replaced=null;
 const button={disabled:false},alert={textContent:''};
 const form={addEventListener:(_,fn)=>{handler=fn;},querySelector:s=>s==='button'?button:alert};
 vm.runInNewContext(remoteLoginJs,{window:{addEventListener(){}},document:{querySelector:s=>s==='form'?form:{value}},fetch:async(url,options)=>{request={url,...options};if(response instanceof Error)throw response;return response;},location:{replace:url=>{replaced=url;}}});
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

test('remote entry restores an existing login only after a successful same-origin read',async()=>{
 for(const response of [{ok:true,status:200},{ok:false,status:403},{ok:false,status:503},Error('offline')]){
  let pageshow,replaced=null;
  const requests=[];
  vm.runInNewContext(remoteLoginJs,{
   window:{addEventListener:(event,handler)=>{assert.equal(event,'pageshow');pageshow=handler;}},
   document:{querySelector:selector=>{assert.equal(selector,'form');return {addEventListener(){}};}},
   fetch:async(url,options)=>{requests.push({url,...options});if(response instanceof Error)throw response;return response;},
   location:{replace:url=>{replaced=url;}}
  });
  assert.equal(requests.length,0);
  pageshow();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(requests,[{url:'/api/sessions',cache:'no-store'}]);
  assert.equal(replaced,response.ok?'/':null);
 }
});

test('a restored login page checks again without submitting a key or replaying work',async()=>{
 let pageshow,paired=false,replaced=null;
 const requests=[];
 vm.runInNewContext(remoteLoginJs,{
  window:{addEventListener:(_,handler)=>{pageshow=handler;}},
  document:{querySelector:selector=>{assert.equal(selector,'form');return {addEventListener(){}};}},
  fetch:async(url,options)=>{requests.push({url,...options});return {ok:paired};},
  location:{replace:url=>{replaced=url;}}
 });
 pageshow();await new Promise(resolve=>setImmediate(resolve));assert.equal(replaced,null);
 paired=true;
 pageshow();await new Promise(resolve=>setImmediate(resolve));assert.equal(replaced,'/');
 assert.deepEqual(requests,[{url:'/api/sessions',cache:'no-store'},{url:'/api/sessions',cache:'no-store'}]);
});

test('remote login trims only surrounding paste whitespace and leaves key content unchanged',async()=>{
 const result=await submit(' \n actual-Test_Key \r\n',{ok:true});
 assert.deepEqual(JSON.parse(result.request.body),{key:'actual-Test_Key'});assert.equal(result.replaced,'/');
 const quoted=await submit('"actual-Test_Key"',{ok:false,json:async()=>({error:'Remote access denied'})});
 assert.equal(JSON.parse(quoted.request.body).key,'"actual-Test_Key"');assert.match(quoted.alert.textContent,/金鑰不正確/);
 assert.match(remoteLoginHtml,/autocapitalize="none"/);assert.match(remoteLoginHtml,/spellcheck="false"/);
});
