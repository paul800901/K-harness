import React,{useEffect,useState,useRef} from 'react';
import {Folder,FolderOpen,ChevronRight,Plus,Pin,Pencil,Archive,ArrowUp,ArrowDown,Ellipsis} from 'lucide-react';
import {projectKey,groupProjectSessions,sortSessions} from './project-groups.mjs';

// Project-row arrangement adapted from DeepSeekHarness ui-workspace/rows/Rows.tsx.
// Copyright (c) 2026 DeepSeek, MIT; see docs/third-party-workspace.md.
function RowMenu({className,label,title,children}) {
  const ref=useRef(null);
  useEffect(()=>{
    const outside=event=>{if(ref.current?.open&&!ref.current.contains(event.target))ref.current.open=false;};
    const escape=event=>{
      if(event.key==='Escape'&&ref.current?.open){event.preventDefault();ref.current.open=false;ref.current.querySelector('summary').focus();}
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('focusin',outside);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[]);
  return <details ref={ref} className={className} name="k-sidebar-row-menu" onClickCapture={event=>{
    if(event.target.closest('button')&&!event.target.closest('button').disabled){ref.current.open=false;ref.current.querySelector('summary').focus();}
  }}><summary aria-label={label} title={title}><Ellipsis size={17}/></summary><div>{children}</div></details>;
}

function ProjectMenu({project,onRenameProject,onProjectMetadata}) {
  const run=(event,action)=>{event.currentTarget.closest('details').open=false;action();};
  return <RowMenu className="project-menu" label={`管理工作區 ${project.name}`} title="工作區選項">
    <button onClick={event=>run(event,()=>onRenameProject(project))}><Pencil size={13}/>重新命名</button>
    <button onClick={event=>run(event,()=>onProjectMetadata({path:project.path,pinned:!project.pinned}))}><Pin size={13}/>{project.pinned?'取消釘選工作區':'釘選工作區'}</button>
    <button onClick={event=>run(event,()=>onProjectMetadata({path:project.path,archived:true}))}><Archive size={13}/>封存工作區</button>
  </RowMenu>;
}

function ProjectRow({project,expanded,containsCurrent,onToggle,onCreate,disabled,onRenameProject,onProjectMetadata,expandable=true}) {
  return <div className={`project-row ${containsCurrent?'contains-current':''}`}>
    {expandable?<button className="project-toggle" title={project.path} aria-label={`${expanded?'收合':'展開'}工作區 ${project.name}`} aria-expanded={expanded} onClick={onToggle}>
      <span className="project-folder">{expanded?<FolderOpen size={16}/>:<Folder size={16}/>}</span>
      <ChevronRight size={15} className={`project-chevron ${expanded?'expanded':''}`}/>
      {project.pinned&&<Pin size={12} className="project-pin"/>}<span>{project.name}</span>
    </button>:<div className="project-label" title={project.path}>
      <span className="project-folder"><Folder size={16}/></span>{project.pinned&&<Pin size={12} className="project-pin"/>}<span>{project.name}</span>
    </div>}
    <button className="project-create" title={`在 ${project.name} 建立新對話`} aria-label={`在 ${project.name} 建立新對話`} disabled={disabled} onClick={onCreate}><Plus size={15}/></button>
    <ProjectMenu project={project} onRenameProject={onRenameProject} onProjectMetadata={onProjectMetadata}/>
  </div>;
}

function SessionRows({sessions,workspace,state,disabled,modelName,onOpen,onRename,onMetadata,onMove,manual}) {
  return sessions.map((s,index)=><div key={s.threadId} className={`session ${state.threadId===s.threadId?'selected':''}`}>
    <button className="session-open" aria-current={state.threadId===s.threadId?'page':undefined} title={`${s.title||'未命名對話'}\n${modelName(s.model)}`} onClick={()=>onOpen({model:s.model,threadId:s.threadId})} disabled={disabled}>
      <span className="session-title">{s.pinned&&<Pin size={11}/>}<span>{s.title||'未命名對話'}</span></span>
      {workspace&&<small className="session-workspace">{typeof workspace==='function'?workspace(s):workspace}</small>}
      <time>{s.lastOpenedAt?new Date(s.lastOpenedAt).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'}):''}</time>
    </button>
    <RowMenu className="session-menu" label={`管理對話 ${s.title||'未命名對話'}`} title="對話選項">
      <p className="session-info">{modelName(s.model)}</p>
      {manual&&<>
        <button disabled={index===0||!!sessions[index-1]?.pinned!==!!s.pinned} onClick={()=>onMove(s,sessions,-1)}><ArrowUp size={13}/>上移對話</button>
        <button disabled={index===sessions.length-1||!!sessions[index+1]?.pinned!==!!s.pinned} onClick={()=>onMove(s,sessions,1)}><ArrowDown size={13}/>下移對話</button>
      </>}
      <button onClick={()=>onRename(s)}><Pencil size={13}/>重新命名</button>
      <button onClick={()=>onMetadata({threadId:s.threadId,pinned:!s.pinned})}><Pin size={13}/>{s.pinned?'取消釘選':'釘選'}</button>
      <button onClick={()=>onMetadata({threadId:s.threadId,archived:true})}><Archive size={13}/>封存對話</button>
    </RowMenu>
  </div>);
}

export function ProjectSidebar({projects,sessions,state,disabled,modelName,layout='grouped',sort='recent',order=[],onOpen,onCreate,onRename,onMetadata,onMove,onRenameProject,onProjectMetadata}) {
  const [collapsed,setCollapsed] = useState(() => {
    try {const saved=JSON.parse(localStorage.getItem('k-collapsed-projects')??'[]');return new Set(Array.isArray(saved)?saved:[]);}catch{return new Set();}
  });
  useEffect(()=>{try{localStorage.setItem('k-collapsed-projects',JSON.stringify([...collapsed]));}catch{}},[collapsed]);
  const groups = groupProjectSessions(projects,sessions,{sort,order});
  if(layout==='flat'){
    const flat=sortSessions(groups.flatMap(project=>project.sessions),{sort,order});
    return <nav className="session-list" aria-label="所有工作區的對話">
      <div className="flat-projects">{groups.map(project=><ProjectRow key={projectKey(project.path)} project={project} expanded={false} containsCurrent={projectKey(state.workspace)===projectKey(project.path)} disabled={disabled} expandable={false} onCreate={()=>onCreate(project.path)} onRenameProject={onRenameProject} onProjectMetadata={onProjectMetadata}/>)}</div>
      <SessionRows sessions={flat} workspace={s=>projects.find(p=>projectKey(p.path)===projectKey(s.workspace))?.name} state={state} disabled={disabled} modelName={modelName} onOpen={onOpen} onRename={onRename} onMetadata={onMetadata} onMove={onMove} manual={sort==='manual'}/>
      {!flat.length&&<p className="empty-list">尚無對話</p>}
    </nav>;
  }
  return <nav className="session-list" aria-label="工作區與對話">
    {groups.map(project=>{
      const key=projectKey(project.path),expanded=!!collapsed.has(key)?false:true;
      const active=projectKey(state.workspace)===key;
      return <section className="project-group" key={key} aria-label={`工作區 ${project.name}`}>
        <ProjectRow project={project} expanded={expanded} containsCurrent={active} disabled={disabled}
          onToggle={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(key))next.delete(key);else next.add(key);return next;})}
          onCreate={()=>onCreate(project.path)} onRenameProject={onRenameProject} onProjectMetadata={onProjectMetadata}/>
        {expanded&&<div className="project-sessions"><SessionRows sessions={project.sessions} state={state} disabled={disabled} modelName={modelName} onOpen={onOpen} onRename={onRename} onMetadata={onMetadata} onMove={onMove} manual={sort==='manual'}/>{!project.sessions.length&&<p className="project-empty">尚無對話</p>}</div>}
      </section>;
    })}
    {!groups.length&&<p className="empty-list">尚無工作區</p>}
  </nav>;
}
