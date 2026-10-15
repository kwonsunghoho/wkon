/* 재생 주소를 저장하지 않는다. 공급자 변경은 서버 어댑터와 업로드 어댑터에 국한한다. */
(function(root){
  'use strict';
  async function call(action,params){
    const {data,error}=await root.MONC.sb.functions.invoke('academy-media',{body:{action,params}});
    if(error) throw new Error('파일 서비스를 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    if(data.error) throw new Error(data.error);
    return data;
  }
  const uploaders={supabase:async function(ticket,file,onProgress){
    if(!root.tus) throw new Error('업로드 도구를 불러오지 못했어요. 새로고침해 주세요.');
    const {data:{session}}=await root.MONC.sb.auth.getSession();
    if(!session)throw new Error('로그인이 만료됐어요. 작성 중인 글을 보관하고 다시 로그인해 주세요.');
    return new Promise((resolve,reject)=>{
      const upload=new root.tus.Upload(file,{
        // 서명 토큰은 전용 경로에서 검증한다. 기존 함수가 주는 TUS 기본 주소도 호환한다.
        endpoint:ticket.endpoint.replace(/\/resumable\/?$/, '/resumable/sign'),headers:{'x-signature':ticket.token,authorization:'Bearer '+session.access_token},
        chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000,10000],
        uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,storeFingerprintForResuming:false,
        metadata:{bucketName:ticket.bucket,objectName:ticket.path,contentType:file.type,cacheControl:'0'},
        onProgress:(sent,total)=>onProgress(Math.round(sent/total*100)),
        onError:()=>reject(Object.assign(new Error('전송이 중단됐어요. 같은 파일로 다시 시도하면 이어 올립니다.'),{resume:()=>new Promise((res,rej)=>{upload.options.onSuccess=res;upload.options.onError=rej;upload.start();})})),
        onSuccess:resolve
      });
      upload.start();
    });
  }};
  function challengeExpired(row,now=Date.now()){
    const sent=Date.parse(row.updated_at||row.created_at);
    return Number.isFinite(sent)&&now>=sent+14*86400000;
  }
  root.MONC_MEDIA={call,challengeExpired,
    async uploadChallenge({memberId,challenge,type,round,file,oldPath}){
      // 기존 챌린지 화면도 공급자·버킷·경로 생성을 여기 한 곳에서만 다룬다.
      const kind=challenge==='expression'?'video':'audio';
      let ext=file.name.includes('.')?file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,''):'';
      if(!ext||ext.length>8)ext=kind==='video'?'mp4':'m4a';
      const path=memberId+'/'+challenge+'-'+type+'/'+crypto.randomUUID()+'.'+ext;
      const up=await root.MONC.sb.storage.from('recordings').upload(path,file,{upsert:false,contentType:file.type||undefined});
      if(up.error)throw up.error;
      const saved=await root.MONC.sb.from('challenge_submissions').upsert({member_id:memberId,challenge,type,round:round||null,storage_path:path},{onConflict:'member_id,challenge,type'});
      if(saved.error)throw saved.error;
      if(oldPath&&oldPath!==path){try{await root.MONC.sb.storage.from('recordings').remove([oldPath]);}catch(_){} }
      return path;
    },
    async prepare(workId,file){
      return call('prepare',{work_id:workId,name:file.name,mime:file.type,bytes:file.size});
    },
    async upload(ticket,file,onProgress){
      const fn=uploaders[ticket.provider];if(!fn) throw new Error('지원하지 않는 저장소입니다.');
      await fn(ticket,file,onProgress);
      return {id:ticket.id};
    },
    finish:id=>call('finish',{id}),
    read:id=>call('read',{id}),
    path:path=>call('path',{path})
  };
})(window);
