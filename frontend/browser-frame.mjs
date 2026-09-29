// The screenshot is fitted in both axes. Ignore the letterbox, then translate
// CSS pixels back into the screenshot's viewport coordinates (not DOM pixels).
export function browserFramePoint({rect,width,height,clientX,clientY}){
 if(!rect||![rect.width,rect.height,width,height].every(value=>Number.isFinite(value)&&value>0))return null;
 if(![rect.left,rect.top,clientX,clientY].every(Number.isFinite))return null;
 const scale=Math.min(rect.width/width,rect.height/height);
 const left=rect.left+(rect.width-width*scale)/2,top=rect.top+(rect.height-height*scale)/2;
 const x=(clientX-left)/scale,y=(clientY-top)/scale;
 if(x<0||y<0||x>=width||y>=height)return null;
 return {x:Math.min(width-1,Math.round(x)),y:Math.min(height-1,Math.round(y))};
}
