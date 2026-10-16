/* 날짜는 한국 시간의 달력 날짜로 다루며 브라우저 시간대에 따라 바뀌지 않는다. */
(function(root){
 'use strict';
 const pad=n=>String(n).padStart(2,'0');
 const parseYmd=s=>new Date(s+'T12:00:00');
 const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 const shift=(s,n)=>{const d=parseYmd(s);d.setDate(d.getDate()+n);return ymd(d);};
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 const categories=['상담','수업','행사','외부일정','기타'];
 function scheduleCategory(s){return ['정규반','단기반','원데이','보충','1:1수업'].includes(s)?'수업':categories.includes(s)?s:'기타';}
 function dates(start,end,mode,weekdays=[]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||ymd(parseYmd(start))!==start)throw Error('날짜를 확인해 주세요.');
  if(mode==='single')return [start];
  if(!end||end<start||ymd(parseYmd(end))!==end)throw Error('종료일을 확인해 주세요.');
  const out=[];let scanned=0;
  for(let d=start;d<=end;d=shift(d,1)){
   if(++scanned>730)throw Error('기간은 2년 이내로 골라 주세요.');
   if(mode==='range'||weekdays.includes(parseYmd(d).getDay()))out.push(d);
  }
  if(!out.length||out.length>400)throw Error('등록 날짜는 1~400개로 골라 주세요.');
  return out;
 }
 root.MONC_OPS_UTIL={pad,parseYmd,ymd,shift,today,categories,scheduleCategory,dates};
})(globalThis);
