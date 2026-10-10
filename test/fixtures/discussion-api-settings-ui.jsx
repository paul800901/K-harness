import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DiscussionApiSettings} from '../../frontend/discussion-api-settings.jsx';
import {DiscussionControls} from '../../frontend/discussion-controls.jsx';

const fakeConnections=[];
const requestLog=[];
async function request(route,data){
 requestLog.push({route,data});
 if(route==='discussion/connections')return {connections:fakeConnections};
 if(route==='discussion/connections/save'){
  const current=fakeConnections.find(item=>item.id===data.id);
  const connection={id:data.id??'connection-1',name:data.name,baseUrl:data.baseUrl,keyConfigured:!!(data.apiKey||current?.keyConfigured),models:data.models};
  if(current)Object.assign(current,connection);else fakeConnections.push(connection);
  return {connection};
 }
 if(route==='discussion/connections/models'){
  const connection=fakeConnections.find(item=>item.id===data.id);connection.models=[{id:'catalog-id',name:'Catalog model'}];return {connection};
 }
 if(route==='discussion/connections/remove'){return {removed:true};}
 throw Error(`Unexpected request route: ${route}`);
}
window.testRequestLog=requestLog;
window.fetch=async url=>{
 window.testFetchLog??=[];window.testFetchLog.push(String(url));
 if(String(url)==='/api/discussion/models')return new Response(JSON.stringify({models:[{route:'api',connectionId:'connection-1',model:'shared-id',displayName:'API shared model',providerLabel:'DeepSeek',available:true,supportedReasoningEfforts:[]}]}),{status:200,headers:{'Content-Type':'application/json'}});
 throw Error(`Unexpected fetch URL: ${url}`);
};

function TestApp(){
 const remote=new URLSearchParams(location.search).has('remote');
 const [mode,setMode]=useState('normal');
 const [config,setConfig]=useState({mode:'normal',participants:[{model:'shared-id',effort:''}],includeContext:true});
 const models=[{model:'shared-id',displayName:'Native shared model',provider:'codex',available:true,supportedReasoningEfforts:[]}];
 return <main>
  <DiscussionApiSettings request={request} disabled={remote}/>
  <DiscussionControls state={{model:'shared-id',effort:'',discussion:null}} models={models} config={{...config,mode}} onChange={next=>{setConfig(next);setMode(next.mode);}} loadModels={async()=>({models})} onCatalog={()=>{}} disabled={false}/>
  <pre id="saved-config">{JSON.stringify(config)}</pre>
 </main>;
}

createRoot(document.getElementById('root')).render(<TestApp/>);
