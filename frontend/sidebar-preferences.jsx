import {useEffect, useRef, useState} from 'react';
import {api, readSidebarOrder, readSidebarPreference, remoteClient} from './app-common.jsx';
import {completeProjectOrder, completeSessionOrder} from './project-groups.mjs';

export function useSidebarPreferences(state, sessions, projects, onError) {
  const [legacy] = useState(() =>
    remoteClient
      ? {layout: 'grouped', sort: 'manual', order: []}
      : {
          layout: readSidebarPreference('k-sidebar-layout', 'grouped', ['grouped', 'flat']),
          sort: readSidebarPreference('k-sidebar-sort', 'manual', ['manual', 'recent']),
          order: readSidebarOrder()
        }
  );
  const initialized = useRef(false),
    appended = useRef('');
  const shared = state.sidebarPreferences;
  const value = shared ?? legacy;
  const order = completeSessionOrder(value.order, sessions);
  const projectOrder = completeProjectOrder(value.projectOrder ?? [], projects);
  useEffect(() => {
    if (state.sidebarPreferencesError) onError(state.sidebarPreferencesError);
  }, [state.sidebarPreferencesError]);
  useEffect(() => {
    if (remoteClient || shared !== null || state.sidebarPreferencesError || initialized.current) return;
    initialized.current = true;
    void api('sidebar/preferences', {initialize: true, ...legacy}).catch(e => onError(e.message));
  }, [shared, state.sidebarPreferencesError]);
  const missing = order.filter(id => !value.order.includes(id));
  const missingProjects = projectOrder.filter(key => !(value.projectOrder ?? []).includes(key));
  const missingKey = JSON.stringify([missing, missingProjects]);
  useEffect(() => {
    if (
      !shared ||
      state.sidebarPreferencesError ||
      (!missing.length && !missingProjects.length) ||
      appended.current === missingKey
    )
      return;
    appended.current = missingKey;
    void api('sidebar/preferences', {append: missing, appendProjects: missingProjects}).catch(e => onError(e.message));
  }, [shared, missingKey, state.sidebarPreferencesError]);
  useEffect(() => {
    // Retain the existing local keys for migration/recovery; the server is authoritative after migration.
    if (!shared || remoteClient) return;
    try {
      localStorage.setItem('k-sidebar-layout', shared.layout);
      localStorage.setItem('k-sidebar-sort', shared.sort);
      localStorage.setItem('k-sidebar-manual-order', JSON.stringify(shared.order));
    } catch {}
  }, [shared]);
  return {...value, order, projectOrder, save: patch => api('sidebar/preferences', patch)};
}
