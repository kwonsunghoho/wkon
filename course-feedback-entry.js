/* 강의 화면과 내 강의실에서 같은 과정의 제출·피드백으로 연결한다. */
(()=>{
 let rows=null,loading=null;
 async function refresh(){
  const watch=document.getElementById('course-feedback-link');if(watch){const eid=new URLSearchParams(location.search).get('enrollment');if(eid)watch.href='course-feedback.html?enrollment='+encodeURIComponent(eid);}
  try{if(!loading)loading=MONC.sb.functions.invoke('online-course-feedback',{body:{action:'summary'}}).then(r=>{if(r.error||!r.data?.ok)throw new Error();rows=r.data.rows;});await loading;
   document.querySelectorAll('[data-feedback-course]').forEach(a=>{const row=rows.find(r=>r.course_id===a.dataset.feedbackCourse);a.querySelector('.fb-entry-status').textContent=row?row.replied_at?'피드백 도착':'검토 중':'제출 전';});
  }catch{loading=null;}
 }
 window.MONCCourseFeedback={refresh};document.addEventListener('DOMContentLoaded',refresh);
})();
