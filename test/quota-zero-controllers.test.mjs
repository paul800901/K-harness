import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createClaudeController} from '../src/claude-controller.mjs';
import {createGeminiController} from '../src/gemini-controller.mjs';
const root=async()=>{const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'quota-zero-controller-'));};

for(const provider of ['codex','claude','gemini'])test(`${provider} automatic quota reads wait for reset; human refresh bypasses suppression`,async()=>{
 const original=Date.now;let now=original(),queries=0,fail=false;Date.now=()=>now;const reset=now+600000;
 let controller;
 try{
  const options={root:await root()};
  if(provider==='codex')controller=createDesktopController({...options,hostFactory:()=>({async request(method){if(method==='account/rateLimits/read'){queries++;if(fail)throw Error('fixture offline');return {rateLimits:{primary:{usedPercent:100,windowDurationMins:300,resetsAt:reset/1000}}};}return {};},notify(){},async close(){}})});
  if(provider==='claude')controller=createClaudeController({...options,hostFactory:async()=>({async usage(){queries++;if(fail)throw Error('fixture offline');return {rate_limits_available:true,rate_limits:{five_hour:{utilization:100,resets_at:new Date(reset).toISOString()}}};},async close(){}})});
  if(provider==='gemini')controller=createGeminiController({...options,loginFactory:()=>({async status(){queries++;if(fail)throw Error('fixture offline');return {quota:{status:'ready',checkedAt:new Date(now).toISOString(),windows:[{key:'five_hour',remainingPercent:0,resetsAt:reset/1000}]}};}})});
  await controller.usage(true);assert.equal(queries,1);const observed=controller.state.usage[provider].checkedAt;
  now+=301000;await controller.usage();await controller.usage();assert.equal(queries,1);assert.equal(controller.state.usage[provider].checkedAt,observed);
  await controller.usage(true);assert.equal(queries,2);
  now=reset;fail=true;await controller.usage();assert.equal(queries,3);assert.equal(controller.state.usage[provider].status,'stale');
  await controller.usage();await controller.usage();assert.equal(queries,3,'failed reset lookup must not bypass existing throttling');
  now+=301000;await controller.usage();assert.equal(queries,4);
 }finally{Date.now=original;await controller?.close();}
});

test('Claude model-scoped zero does not suppress quota lookup for other models',async()=>{
 let queries=0;const controller=createClaudeController({root:await root(),hostFactory:async()=>({async usage(){queries++;return {rate_limits_available:true,rate_limits:{seven_day_opus:{utilization:100,resets_at:new Date(Date.now()+86400000).toISOString()}}};},async close(){}})});
 try{await controller.usage(true);await controller.usage(true);assert.equal(queries,2);
  // Make only the existing interval eligible; the scoped zero itself is unchanged.
  const original=Date.now;Date.now=()=>original()+301000;try{await controller.usage();assert.equal(queries,3);}finally{Date.now=original;}
 }finally{await controller.close();}
});
