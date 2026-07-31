/* ══════════════════════════════════════════════════════════════════════════
   몬크 연구진 데이터 — 단일 원본 (2026-07-31 researchers.html 에서 이관)

   쓰는 곳: researchers.html(연구진 페이지). lab.html 허브의 연구진 임베드는
   2026-07-31 오너 지시(허브 = 카드 두 장)로 빠졌다 — 허브 '연구진' 카드가
   researchers.html 로 연결한다.
   ⚠️ 연구원 정보를 페이지에 복사해 넣지 말 것 — nav 가 세 페이지에 복사돼
      자주 어긋났던 것과 같은 사고를 막으려고 이 파일 하나로 모았다.
   연구원 수를 화면에 쓸 땐 이 배열 길이가 원본이다(lab.html 허브 카드 '연구원 6명').
   ══════════════════════════════════════════════════════════════════════════ */
window.MONC_RESEARCHERS = [
  {
    id:'kwon',
    role:'수석 연구원',
    name:'권성호',
    position:'보이스·스피치·표현력 전문가',
    photo:'images/instructor-kwon.webp',
    tags:['발성 트레이닝','보이스 코칭','스피치 코칭','영상면접 전문 코칭','항공과 특강'],
    bio:'11년간 승무원 면접 전문 교육기관 <strong>MONSTERCREW & MONC(몬크)</strong>를 운영하며 다수의 합격생을 배출했습니다. 발성부터 스피치, 표현력까지 면접에서의 목소리 전반을 다룹니다.',
    stats:[
      {num:11, suffix:'년', label:'전문 교육 경력'},
      {num:3500, suffix:'+', label:'온라인 수강생'},
      {num:'다수', suffix:'', label:'대학·기관 특강'}
    ],
    key:[
      '승무원 면접 전문 교육기관 <strong>MONSTERCREW & MONC(몬크) 11년 운영</strong>',
      '누적 온라인 수강생 <strong>3,500명+</strong> 지도',
      '<strong>국토부 주관 2023·2025 항공잡페어</strong> 취업컨설턴트',
      '발성 트레이닝 <strong>자체 코칭북</strong> 개발·보급'
    ],
    more:[
      '취업·보이스 통합 코칭 프로그램 개발 및 운영',
      '국내 항공과·대학 항공사 특강 프로그램 보이스 코칭 다수',
      '보이스·커뮤니케이션 전문 칼럼 언론 기고 연재',
      '유튜브·팟캐스트 출연'
    ]
  },
  {
    id:'park',
    role:'수석 연구원',
    name:'박새암',
    position:'객실승무원 출신 · 면접 & 스피치 전문가',
    photo:'images/instructor-park.webp',
    tags:['승무원 면접','영상면접','쇼호스트','자기브랜딩'],
    bio:'FSC·LCC 객실승무원 9년, 공기업·대기업 면접관 활동까지. <strong>합격해본 입장과 평가하는 입장을 모두</strong> 아는 만큼 실전에 바로 쓰는 면접 전략을 알려드려요.',
    stats:[
      {num:9, suffix:'년', label:'승무원 경력'},
      {num:1000, suffix:'+', label:'면접 컨설팅'},
      {num:1000, suffix:'회', label:'누적 방송'}
    ],
    key:[
      '외항사 FSC·국내 LCC <strong>객실승무원 9년차</strong> (동방항공 비즈니스 클래스 · 에어서울 부사무장 · 티웨이 경력직 · 스쿠트항공 최합)',
      '<strong>국토부 주관 2025 항공잡페어</strong> 취업컨설턴트 · <strong>한국항공대 주관 2025 활주로 일자리박람회</strong> 취업컨설턴트',
      '<strong>NCS 기반 채용면접관 2급</strong> · 공사·기업 외부 면접관 · 다수 기업 면접관 경력',
      '여의도여고·인천외고 등 <strong>초·중·고 20개교 이상</strong> 항공승무원 직업특강 출강',
      '채널A 《비행기 타고가요》 시즌1 다카마스편 출연'
    ],
    more:[
      '<strong>몬스터크루 & 몬크 아카데미</strong> 대표강사 · 현) 몬크 수석연구원',
      '현) <strong>프리랜서 쇼호스트 5년차</strong> (누적 방송 1,000회+) · 전) LF mall 전속 쇼호스트',
      '에코프론티어 환경 컨설턴트 · 지속가능경영보고서 제작 및 디자인 support',
      '국내 대형 디자인회사 · Los Angeles American Apparel 자회사 합격 이력'
    ]
  },
  {
    id:'koh',
    role:'책임 연구원',
    name:'고은지',
    position:'브랜딩 · 스피치 · 라이브커머스 전문가',
    photo:'images/instructor-koh.webp',
    tags:['쇼호스트','MC'],
    bio:'<strong>차별화된 나만의 브랜딩</strong>부터 스피치까지 현장에서 쌓은 경험을 전합니다.',
    stats:[
      {num:10, suffix:'년', label:'현장 경력'},
      {num:500, suffix:'회+', label:'라이브커머스'},
      {num:'다수', suffix:'', label:'승무원 배출'}
    ],
    key:[
      'FSC·LCC 객실승무원 <strong>다수 배출</strong>',
      '진안군 우화지구 <strong>도시재생대학</strong> 기초·심화과정 교육 강의',
      '기전대 소상공인 <strong>온라인 라이브커머스 판로지원</strong> 강의',
      '동행세일 그립 · 전라북도 로컬마켓 등 <strong>라이브커머스 500회 이상</strong>'
    ],
    more:[
      '전주비빔밥축제 명인·명가 이야기 MC',
      '군산시 농어촌종합지원센터 · 전주 소담스퀘어 라이브커머스 강사',
      '완주 로컬푸드축제 · 무주특산물 천마니 쇼호스트',
      "'위기를 기회로' 동행세일 라이브커머스 방송 진행"
    ]
  },
  {
    id:'choi',
    role:'선임 연구원',
    name:'최보민',
    position:'대한항공 출신 · 답변 & 면접 전문가',
    photo:'images/instructor-choi.webp',
    tags:['차별화된 답변','대한항공 특화 구조화','LCC 면접 전략','이미지 메이킹'],
    bio:'대한항공 국제선에서 <strong>First·Business Class</strong>를 담당하고 객실 부사무장까지 지낸 전직 승무원 취업 전문 강사입니다. <strong>대한항공·LCC 면접에 특화된</strong> 차별화된 답변 설계와 답변 구조화, 항공사별 이미지 메이킹을 지도합니다.',
    stats:[
      {num:'대한항공', suffix:'', label:'국제선 객실승무원'},
      {num:'부사무장', suffix:'', label:'객실 부사무장 근무'},
      {num:'제주항공', suffix:'', label:'객실승무원 · 사내 모델'}
    ],
    key:[
      '<strong>대한항공 국제선 객실승무원</strong> · First·Business Class 담당',
      '대한항공 <strong>객실 부사무장</strong> 근무',
      '<strong>제주항공 객실승무원</strong> · 사내 모델 활동',
      '대한항공·제주항공 <strong>기내 방송 자격</strong> 보유'
    ],
    more:[
      '지원자별 강점이 드러나는 승무원 자기소개서 작성 및 첨삭',
      '면접 답변 구조화 및 전략 설계',
      'FSC·LCC 항공사별 이미지 메이킹',
      '승무원 면접 스피치 및 표현력 지도'
    ]
  },
  {
    id:'kim',
    role:'선임 연구원',
    name:'김유리',
    position:'대한항공 출신 · 기내방송 & 스피치 전문가',
    photo:'images/instructor-kim.webp',
    tags:['기내방송','스피치 지도','일등석·프레스티지','VIP 서비스'],
    bio:'대한항공 국제선에서 10년간 근무하며 <strong>일등석·프레스티지 클래스</strong>와 VIP 고객 서비스를 담당하고 객실 부사무장까지 지낸 전직 승무원입니다. <strong>기내방송 전문성과 스피치지도사 1급</strong> 자격을 바탕으로 정확한 발음·전달력을 지도합니다.',
    stats:[
      {num:10, suffix:'년', label:'대한항공 승무원'},
      {num:9000, suffix:'시간', label:'국제선 비행'},
      {num:'부사무장', suffix:'', label:'객실 부사무장'}
    ],
    key:[
      '<strong>대한항공 국제선 객실승무원</strong> · 객실 부사무장 (10년)',
      '국제선 비행 <strong>약 9,000시간</strong>',
      '대한항공 <strong>일등석·프레스티지 클래스</strong> 근무',
      '<strong>기내방송 전문</strong>'
    ],
    more:[
      'VIP 고객 서비스 담당',
      '스피치지도사 <strong>1급</strong>'
    ]
  },
  {
    id:'hyun',
    role:'선임 연구원',
    name:'현형빈',
    position:'해외 경력 · 글로벌 커뮤니케이션 전문가',
    photo:'images/instructor-hyun.webp',
    tags:['글로벌 커뮤니케이션','영어 교육','해외 실무','팀 리드'],
    bio:'미국 오하이오 주립대에서 경제학을 전공하고 <strong>뉴욕·싱가포르</strong>에서 총괄 매니저와 글로벌 마케팅·PR 팀장을 지냈습니다. 영어 교육 강사 경력까지 더해 <strong>글로벌 무대에서 통하는 커뮤니케이션</strong>을 전합니다.',
    stats:[
      {num:'글로벌', suffix:'', label:'미국·싱가포르 경력'},
      {num:'팀 리드', suffix:'', label:'총괄 매니저 · 팀장'},
      {num:'영어', suffix:'', label:'영어교육 전문 강사'}
    ],
    key:[
      '<strong>OHIO STATE UNIVERSITY</strong> 졸업 · Economics 전공',
      '<strong>Singapore-based Digital Finance Platform</strong> Global Marketing Head · 글로벌기업 본사 마케팅 및 글로벌 PR 팀장',
      '<strong>Vault Korea Accelerator</strong> Team Lead · 국내기업의 미국진출 컨설팅사, 20개사 이상의 해외 진출을 돕는 정부 프로그램 팀장',
      '<strong>Newyork PH Group</strong> General Manager · 뉴욕 현지 F&amp;B 기업의 총괄 매니저'
    ],
    more:[
      '<strong>WOORI Investment Group</strong> 파생상품팀 및 리서치 센터 RA',
      '<strong>English Exam Preparation Instructor</strong> · 국내 수능 및 English Test 강사'
    ]
  }
];
