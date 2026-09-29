const {contextBridge,ipcRenderer}=require('electron');
// Only the trusted workbench gets this preload. Web pages never do.
contextBridge.exposeInMainWorld('kBrowser',Object.freeze({
 present:request=>ipcRenderer.invoke('k-native-browser-present',request),
 hide:request=>ipcRenderer.invoke('k-native-browser-hide',request),
 onPageChanged:callback=>{
  if(typeof callback!=='function')throw new TypeError('Callback required.');
  const listener=(_event,data)=>callback(data);ipcRenderer.on('k-native-browser-page',listener);
  return()=>ipcRenderer.removeListener('k-native-browser-page',listener);
 },
 onWindowHidden:callback=>{
  if(typeof callback!=='function')throw new TypeError('Callback required.');
  const listener=()=>callback();ipcRenderer.on('k-native-window-hidden',listener);
  return()=>ipcRenderer.removeListener('k-native-window-hidden',listener);
 },
}));
