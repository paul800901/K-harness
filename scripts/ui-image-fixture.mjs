// Synthetic two-colour PNG for the local attachment UI acceptance. No user data.
import {deflateSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
const width=320,height=160;
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,check]);}
const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
const rows=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const offset=y*(width*3+1)+1+x*3;rows.set(x<width/2?[230,30,30]:[25,70,235],offset);}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
const directory=new URL('../.runtime/ui-acceptance/',import.meta.url);await mkdir(directory,{recursive:true});await writeFile(new URL('two-colours.png',directory),png,{flag:'wx'});
console.log('Created synthetic .runtime/ui-acceptance/two-colours.png');
