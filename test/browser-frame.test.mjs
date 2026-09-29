import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFramePoint} from '../frontend/browser-frame.mjs';
test('browser clicks respect horizontal and vertical letterboxing at any viewport',()=>{
 const rect={left:10,top:20,width:400,height:600};
 assert.deepEqual(browserFramePoint({rect,width:1440,height:900,clientX:210,clientY:320}),{x:720,y:450});
 assert.equal(browserFramePoint({rect,width:1440,height:900,clientX:210,clientY:50}),null);
 assert.deepEqual(browserFramePoint({rect,width:900,height:1440,clientX:210,clientY:320}),{x:450,y:720});
 assert.equal(browserFramePoint({rect,width:900,height:1440,clientX:11,clientY:320}),null);
 assert.deepEqual(browserFramePoint({rect:{left:0,top:0,width:720,height:450},width:1440,height:900,clientX:180,clientY:112.5}),{x:360,y:225});
});
test('browser click mapping rejects unavailable images and non-finite coordinates',()=>{
 for(const value of [0,NaN,Infinity,-1])assert.equal(browserFramePoint({rect:{left:0,top:0,width:400,height:300},width:value,height:900,clientX:5,clientY:5}),null);
 assert.equal(browserFramePoint({rect:{left:0,top:0,width:400,height:300},width:1440,height:900,clientX:NaN,clientY:5}),null);
});
