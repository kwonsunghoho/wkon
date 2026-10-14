// 서버가 발급한 서명 토큰이 회원 RLS 업로드 경로로 잘못 전달되는 회귀를 막는다.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
let sent;
const root={MONC:{sb:{auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}}},
  tus:{Upload:class{constructor(file,options){sent=options;}start(){sent.onSuccess();}}}};
vm.runInNewContext(fs.readFileSync('media-storage.js','utf8'),{window:root});
(async()=>{
  const base='https://example.storage.supabase.co/storage/v1/upload/resumable';
  for(const endpoint of [base,base+'/',base+'/sign']){
    await root.MONC_MEDIA.upload({provider:'supabase',id:'test',endpoint,token:'test-signature',bucket:'academy-media',path:'test/file'}, {type:'audio/mp4'},()=>{});
    assert.equal(sent.endpoint,base+'/sign');
    assert.equal(sent.headers['x-signature'],'test-signature');
    assert.equal(sent.metadata.bucketName,'academy-media');
    assert.equal(sent.metadata.objectName,'test/file');
    assert.equal(sent.chunkSize,6*1024*1024);
  }
  console.log('서명 업로드 주소 호환 3개 검사 통과');
})().catch(e=>{console.error(e);process.exitCode=1;});
