// The phone needs live conversation/control state, not every historical tool
// output on each reconnect. Full records stay in the same controller and are
// read explicitly when their existing detail view is expanded.
const toolSummary=({output,details,patchChanges,...tool})=>({...tool,detailsDeferred:true,hasPatchChanges:!!patchChanges?.length});
const diffSummary=({diff,...record})=>({...record,diffDeferred:true});

export function remoteStateEvent(event){
 if(event.type==='snapshot')return {...event,state:{...event.state,tools:(event.state.tools??[]).map(toolSummary),turnDiffs:(event.state.turnDiffs??[]).map(diffSummary)}};
 const changes={...event.changes};
 if(changes.turnDiffs)changes.turnDiffs=changes.turnDiffs.map(diffSummary);
 if(changes.tools){
  const delta=changes.tools,upsert=(delta.upsert??[]).filter(op=>op.tool).map(op=>({...op,tool:toolSummary(op.tool)}));
  if(delta.remove?.length||delta.order||upsert.length)changes.tools={...delta,upsert};
  else delete changes.tools;
 }
 return {...event,changes};
}
