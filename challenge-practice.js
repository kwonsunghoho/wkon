/* 체험 녹음과 댓글은 현재 페이지의 메모리에서만 사용한다. */
(function () {
'use strict';
const el=id=>document.getElementById(id);
const rec=el('record'),file=el('file'),review=el('review'),player=el('previewAudio'),share=el('share'),status=el('mStatus');
const exampleAudio='audio/practice-vowels.wav';
let mic=null,activeStream=null,pendingUrl=null,ownArticle=null,sequence=0,deadline=0,interval=0;
function activeButtons(on){rec.disabled=!on;el('pick').disabled=!on}
function cleanupStream(){if(activeStream){activeStream.getTracks().forEach(t=>t.stop());activeStream=null}clearInterval(interval);clearTimeout(deadline)}
function clearDraft(){player.pause();player.removeAttribute('src');player.load();if(pendingUrl)URL.revokeObjectURL(pendingUrl);pendingUrl=null;review.hidden=true;share.disabled=true;file.value=''}
function playback(blob){clearDraft();pendingUrl=URL.createObjectURL(blob);player.src=pendingUrl;player.load();review.hidden=false;share.disabled=true;status.textContent=''}
player.addEventListener('loadedmetadata',()=>{share.disabled=false});
player.addEventListener('error',()=>{if(!pendingUrl)return;share.disabled=true;status.textContent='이 음성은 재생할 수 없어요. 다른 녹음 파일을 선택해 주세요.'});
function addEntry(name,url,own=false){
 const a=document.createElement('article');a.className='entry';a.innerHTML='<div class="entryHead"><span class="avatar"></span><span class="who"></span><span class="hint"></span></div><audio controls preload="metadata"></audio><ul class="replies"></ul><form class="reply"><input type="text" maxlength="120" placeholder="한 줄 남기기"><button type="submit" class="btn">등록</button></form>';
 a.querySelector('.avatar').textContent=own?'나':'연';a.querySelector('.who').textContent=name;a.querySelector('.hint').textContent=own?'내 녹음':'예시 녹음';
 const audio=a.querySelector('audio');audio.src=url;audio.setAttribute('aria-label',name+' 녹음 재생');const form=a.querySelector('form'),input=a.querySelector('input'),replies=a.querySelector('ul');
 input.setAttribute('aria-label',name+' 녹음에 한 줄 남기기');
 function addReply(who,msg){const li=document.createElement('li'),b=document.createElement('b');b.textContent=who;const message=document.createElement('span');message.textContent=msg;li.append(b,message);replies.append(li)}
 if(!own)addReply('하늘','모음마다 첫 소리가 또렷하게 들려요.');
 form.onsubmit=e=>{e.preventDefault();const msg=input.value.trim();if(!msg){input.focus();return}addReply('나',msg);input.value='';input.focus()};
 el('feed').prepend(a);return a
}
addEntry('연습 메이트',exampleAudio);
document.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true);

el('pick').onclick=()=>file.click();
file.onchange=()=>{const f=file.files[0];if(!f)return;if(f.size===0||f.size>50*1024*1024||!(f.type.startsWith('audio/')||/\.(m4a|mp3|wav|webm|aac|ogg|opus|flac)$/i.test(f.name))){status.textContent='50MB 이하의 녹음 파일을 선택해 주세요.';file.value='';return}playback(f)};
el('discard').onclick=()=>{clearDraft();status.textContent='다른 녹음을 선택할 수 있어요.'};
share.onclick=()=>{if(!pendingUrl||share.disabled)return;const url=pendingUrl;pendingUrl=null;if(ownArticle){const old=ownArticle.querySelector('audio');old.pause();URL.revokeObjectURL(old.src);ownArticle.remove()}ownArticle=addEntry('나',url,true);clearDraft();status.textContent='체험 화면에 녹음을 올렸어요.';ownArticle.scrollIntoView({block:'nearest'})};
rec.onclick=async()=>{
 if(mic?.state==='recording'){mic.stop();return}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status.textContent='이 환경에서는 파일 선택으로 녹음을 올릴 수 있어요.';return}
 activeButtons(false);status.textContent='마이크 사용을 허용해 주세요.';
 try{
 const stream=await navigator.mediaDevices.getUserMedia({audio:true});if(document.visibilityState === "hidden"){stream.getTracks().forEach(t=>t.stop());return}activeStream=stream;
 const r=new MediaRecorder(stream),chunks=[];mic=r;
 r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 r.onstop=()=>{cleanupStream();mic=null;rec.textContent='녹음하기';activeButtons(true);if(chunks.length)playback(new Blob(chunks,{type:r.mimeType||chunks[0].type}));else status.textContent='녹음된 소리가 없어요. 다시 시도해 주세요.'};
 r.onerror=()=>{status.textContent='녹음이 중단됐어요. 파일 선택으로도 올릴 수 있어요.';if(r.state!=='inactive')r.stop()};
 r.start(500);rec.disabled=false;rec.textContent='녹음 마치기';let start=Date.now();const tick=()=>{const sec=Math.floor((Date.now()-start)/1000);status.textContent='녹음 중 '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};tick();interval=setInterval(tick,500);deadline=setTimeout(()=>{if(r.state==='recording')r.stop()},120000);
 }catch(e){cleanupStream();mic=null;activeButtons(true);status.textContent='마이크를 사용할 수 없어요. 권한을 확인하거나 파일을 선택해 주세요.'}
 finally{if(!mic)activeButtons(true)}
};
window.addEventListener('pagehide',()=>{if(mic?.state==='recording')mic.stop();cleanupStream()});

})();
