export const projectKey = p => String(p ?? '').replaceAll(String.fromCharCode(92),'/').replace(/\/+$/,'').toLowerCase();
export const isVisibleMainSession = session => !session?.parentThreadId || session?.branchType === 'user';

const recentOrder=(a,b)=>{
  const left=Date.parse(a.sortAt??a.lastOpenedAt??'')||0,right=Date.parse(b.sortAt??b.lastOpenedAt??'')||0;
  return right-left||String(a.threadId).localeCompare(String(b.threadId));
};

export function sortSessions(sessions,{sort='recent',order=[]}={}) {
  const position=new Map(order.map((id,index)=>[id,index]));
  return [...sessions].sort((a,b)=>{
    const pinned=Number(!!b.pinned)-Number(!!a.pinned);
    if(pinned)return pinned;
    if(sort==='manual'){
      const ai=position.get(a.threadId)??Number.MAX_SAFE_INTEGER;
      const bi=position.get(b.threadId)??Number.MAX_SAFE_INTEGER;
      if(ai!==bi)return ai-bi;
    }
    return recentOrder(a,b);
  });
}

export function completeSessionOrder(order,sessions) {
  const known=new Set(order);
  const added=sortSessions(sessions.filter(isVisibleMainSession)).filter(s=>!known.has(s.threadId)).map(s=>s.threadId);
  return added.length?[...order,...added]:order;
}

export function moveSessionOrder(order,sessions,visibleSessions,threadId,direction) {
  const complete=sortSessions(sessions,{sort:'manual',order}).map(s=>s.threadId);
  const visible=sortSessions(visibleSessions,{sort:'manual',order});
  const index=visible.findIndex(s=>s.threadId===threadId);
  const adjacent=visible[index+direction];
  const current=visible[index];
  if(!current||!adjacent||!!current.pinned!==!!adjacent.pinned)return complete;
  const a=complete.indexOf(current.threadId),b=complete.indexOf(adjacent.threadId);
  if(a<0||b<0)return complete;
  [complete[a],complete[b]]=[complete[b],complete[a]];
  return complete;
}

export function groupProjectSessions(projects, sessions, {archived=false, query='', sort='recent', order=[]}={}) {
  const search = query.trim().toLocaleLowerCase('zh-TW');
  return projects.filter(project => !project.archived).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)).map(project => {
    const own = sessions.filter(s => isVisibleMainSession(s) && projectKey(s.workspace) === projectKey(project.path) && !!s.archived === archived);
    const matchingProject = project.name.toLocaleLowerCase('zh-TW').includes(search);
    const matching = own.filter(s => matchingProject || `${s.title??''} ${s.model??''}`.toLocaleLowerCase('zh-TW').includes(search));
    return {...project, sessions:sortSessions(matching,{sort,order})};
  }).filter(p => !search || p.sessions.length || p.name.toLocaleLowerCase('zh-TW').includes(search));
}

export function searchSessions(projects,sessions,query) {
  const search=String(query??'').trim().toLocaleLowerCase('zh-TW');
  if(!search)return [];
  const names=new Map(projects.filter(project=>!project.archived).map(project=>[projectKey(project.path),project.name]));
  const archivedProjects=new Set(projects.filter(project=>project.archived).map(project=>projectKey(project.path)));
  return sortSessions(sessions.filter(s=>isVisibleMainSession(s)&&!archivedProjects.has(projectKey(s.workspace))&&`${s.title??''} ${names.get(projectKey(s.workspace))??s.workspace??''} ${s.model??''}`.toLocaleLowerCase('zh-TW').includes(search)));
}
