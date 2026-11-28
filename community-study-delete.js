/* 스터디 목록과 어드민이 같은 확인 문구와 삭제 API를 사용한다. */
window.MONCStudyDelete = async function(id,title) {
  if(!window.confirm('「'+title+'」 스터디를 영구 삭제할까요?\n모집글, 지원·참여 내역, 스터디룸의 과제·제출물·피드백이 함께 삭제됩니다. 복구할 수 없습니다.'))return false;
  const {data,error}=await MONC.sb.rpc('community_delete_study',{p_id:id,p_title:title});
  if(error?.message?.includes('community:study_changed')) {
    throw new Error('스터디 제목이 변경됐습니다. 새로고침한 뒤 다시 확인해 주세요.');
  }
  if(error || !data?.ok)throw new Error('스터디를 삭제하지 못했습니다. 관리자 권한과 연결 상태를 확인해 주세요.');
  return true;
};
