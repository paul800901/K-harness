export function compactionLabel(progress){
 const count=progress?.compactions;
 if(Number.isSafeInteger(count)&&count>=0&&progress?.compactionsComplete===true)return `已壓縮 ${count} 次`;
 return count>0?`壓縮次數未知（已記錄 ${count} 次）`:'壓縮次數未知';
}
