// Native page notifications can arrive after a panel or conversation changes.
// Reconcile against the owner API's current thread state before touching tabs.
export function reconcileNativePageChange(event,state,threadId,{select=false}={}){
 if(!event||event.threadId!==threadId||typeof event.pageId!=='string'||!state||state.threadId&&state.threadId!==threadId)return null;
 const pages=Array.isArray(state.pages)?state.pages:[];
 if(event.closed){
  if(pages.some(page=>page.id===event.pageId))return null;
  return {type:'closed',pageId:event.pageId};
 }
 const page=pages.find(item=>item.id===event.pageId);
 if(!page)return null;
 return {type:'opened',pageId:page.id,title:page.title,url:page.url,select:select&&state.selectedPageId===page.id};
}

export function planNativePagePanelChange(change,event,{panelTabs=[],panel='artifacts',inspector=false,dismissed=false}={}){
 if(!change)return null;
 if(change.type==='closed')return change;
 if(change.type!=='opened'||dismissed)return null;
 const pageTab=`browser:${change.pageId}`;
 if(panelTabs.includes(pageTab))return null;
 const activeBrowser=inspector&&panel.startsWith('browser:');
 const hasPageTabs=panelTabs.some(id=>id.startsWith('browser:')&&id!=='browser:current');
 const url=change.url||'';
 const initialNavigation=event?.reason==='navigate'&&url!==''&&!/^about:blank(?:$|[?#])/i.test(url)&&!hasPageTabs;
 if(event?.reason==='navigate'&&/^about:blank(?:$|[?#])/i.test(url))return null;
 const popup=event?.reason==='popup-open';
 return {...change,select:initialNavigation||(change.select&&activeBrowser&&(popup||event?.reason==='popup-return')),openInspector:initialNavigation||popup};
}
