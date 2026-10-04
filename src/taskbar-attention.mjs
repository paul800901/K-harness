const DIGITS={
 '0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],
 '3':['111','001','111','001','111'],'4':['101','101','111','001','001'],'5':['111','100','111','001','111'],
 '6':['111','100','111','101','111'],'7':['111','001','001','001','001'],'8':['111','101','111','101','111'],
 '9':['111','101','111','001','111'],'+':['000','010','111','010','000'],
};

function badgeBitmap(electron,count){
 const width=32,height=32,pixels=Buffer.alloc(width*height*4),label=count>9?'9+':String(count);
 const scale=label.length>1?3:4,glyphWidth=(label.length*5-2)*scale,glyphHeight=5*scale;
 const startX=Math.floor((width-glyphWidth)/2),startY=Math.floor((height-glyphHeight)/2);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=x-15.5,dy=y-15.5;
  if(dx*dx+dy*dy>15*15)continue;
  const offset=(y*width+x)*4;
  pixels[offset]=45;pixels[offset+1]=55;pixels[offset+2]=220;pixels[offset+3]=255;
 }
 for(let i=0;i<label.length;i++){
  const rows=DIGITS[label[i]];
  for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(rows[y][x]==='1'){
   for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++){
    const px=startX+i*5*scale+x*scale+sx,py=startY+y*scale+sy,offset=(py*width+px)*4;
    pixels[offset]=255;pixels[offset+1]=255;pixels[offset+2]=255;pixels[offset+3]=255;
   }
  }
 }
 return electron.nativeImage.createFromBitmap(pixels,{width,height,scaleFactor:1});
}

const isFocusedAndVisible=window=>{
 try{return window.isFocused()===true&&window.isVisible()===true;}catch{return false;}
};

export function createTaskbarAttentionController({window,electron,app,platform=process.platform,flashDurationMs=3000,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}){
 if(platform!=='win32'||typeof window?.setOverlayIcon!=='function'||typeof app?.onStateChange!=='function')return {dispose(){}};
 let disposed=false,hasSnapshot=false,lastSequence=0,lastUnreadCount=null,timer=null;
 const stopFlash=()=>{
  if(timer===null)return;
  clearTimeoutFn(timer);timer=null;
  try{window.flashFrame(false);}catch{}
 };
 const update=state=>{
  if(disposed)return;
  const attention=state?.completionAttention;
  const sequence=Number.isFinite(attention?.sequence)?attention.sequence:0;
  const unread=Array.isArray(attention?.unread)?attention.unread:[];
  const unreadCount=unread.length;
  if(unreadCount!==lastUnreadCount){
   lastUnreadCount=unreadCount;
   try{
    const icon=unreadCount?badgeBitmap(electron,unreadCount):null;
    window.setOverlayIcon(icon,unreadCount?`${unreadCount} 個未讀完成工作`:'' );
   }catch{}
  }
  if(!hasSnapshot){hasSnapshot=true;lastSequence=sequence;return;}
  const previousSequence=lastSequence,isNewCompletion=sequence>previousSequence;
  if(isNewCompletion)lastSequence=sequence;
  if(!isNewCompletion||!unread.some(item=>Number.isFinite(item?.sequence)&&item.sequence>previousSequence))return;
  if(isFocusedAndVisible(window)){stopFlash();return;}
  stopFlash();
  try{window.flashFrame(true);}catch{return;}
  timer=setTimeoutFn(()=>{timer=null;try{window.flashFrame(false);}catch{}},flashDurationMs);
 };
 let unsubscribe;
 try{unsubscribe=app.onStateChange(update);}catch{}
 const onFocus=()=>stopFlash();
 window.on('focus',onFocus);
 return {dispose(){
  if(disposed)return;disposed=true;stopFlash();
  window.removeListener?.('focus',onFocus);
  try{unsubscribe?.();}catch{}
  if(lastUnreadCount!==null&&lastUnreadCount!==0){lastUnreadCount=0;try{window.setOverlayIcon(null,'');}catch{}}
 }};
}

export function createWindowFocusNotifier(window,webContents){
 let disposed=false;
 const notify=()=>{
  if(disposed)return;
  try{
   if(!webContents.isDestroyed())webContents.send('k-native-window-focus',{focused:isFocusedAndVisible(window)});
  }catch{}
 };
 window.on('focus',notify);window.on('blur',notify);window.on('hide',notify);
 return {notify,dispose(){
  if(disposed)return;disposed=true;
  window.removeListener?.('focus',notify);window.removeListener?.('blur',notify);window.removeListener?.('hide',notify);
 }};
}
