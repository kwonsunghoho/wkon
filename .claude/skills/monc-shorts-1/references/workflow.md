# 제작 절차

## 환경

Python 3.12와 Pillow 11.1.0(번들 requirements.txt), H.264·PNG·오버레이 필터를 지원하는 FFmpeg를 사용한다. 설치된 실행 파일을 먼저 확인한다. 번들 글꼴은 동일한 파일의 SHA-256을 검증한다. 시스템 폰트나 유사 서체로 대체하지 않는다.

`python scripts/render.py --plan PLAN.json --input INPUT.mov --out OUTPUT_DIR --ffmpeg FFMPEG_PATH --preview-only`

375px 프리뷰를 확인한 뒤 같은 인수에서 `--preview-only`를 빼고 출력한다. 결과는 OUTPUT_DIR의 `MONC_shorts1.mp4`다. OUTPUT_DIR과 PLAN.json은 공개 저장소 밖의 작업용 폴더에 둔다.

오디오 기본값은 원음 복사다. MP4에 복사할 수 없는 코덱일 때만 `--audio-mode aac`를 명시한다. 음성 자체의 피치·속도·음량은 바꾸지 않는다.

## 영상별 계획 JSON

`cues`는 [시작초, 종료초, 발화자막] 배열이다. 자막 문자열의 줄바꿈은 JSON의 \n으로 기록한다. 시작·종료를 원본 음성과 대조한다. 인트로 종료 뒤에는 본문 90px·최대 2줄을 유지한다.

`duration`에는 원본 길이(초), `frame_shift`에는 1080×1920으로 맞춘 영상의 위쪽 이동량을 넣는다. 얼굴이 카드와 겹치면 구도를 조절하고 대표 프레임을 다시 확인한다. 0이면 원래 구도를 유지한다.

`intro`는 start, end, label, title(문자열 1~2개 배열)이다. `labels`는 start, end, text 배열이다. `cards`는 start, end, header, left, right 또는 summary 배열이다. 카드와 라벨을 같은 구간에 넣지 않는다.

예시 구조:

```json
{
  "duration": 4,
  "frame_shift": 0,
  "preview_times": [0.5, 2.5, 3.5],
  "cues": [[0, 2, "먼저 핵심을 말합니다."], [2, 4, "그다음 이유를 설명합니다."]],
  "intro": {"start": 0, "end": 2, "label": "면접 노트", "title": ["핵심을 먼저,", "이유는 그다음에"]},
  "labels": [],
  "cards": [{"start": 2, "end": 4, "header": "답변의 순서", "left": "핵심", "right": "이유"}]
}
```

## 검수

- PNG의 실제 글자 높이와 줄 시작점 간격을 확인한다. 90px이라는 선언값만 보고 판단하지 않는다.
- 글꼴 해시, 자막 순서·시간·분량, 2줄·900px 제한을 확인한다.
- 영상마다 인트로, 일반 자막, 설명 카드, 마지막 장면을 실제 375px 이미지로 본다.
- 프리뷰 뒤 전체 MP4에서도 같은 장면과 끝부분을 디코딩한다. 검은 빈 하단·잘림·입 가림·깨진 문자가 없는지 확인한다.
- 원음 복사라면 소스와 출력 오디오 패킷의 해시를 비교할 수 있다.
- 영상별 대본·타임코드·전사 파일은 사용자가 제공한 작업 데이터다. 스킬에 끼워 넣거나 공개 저장소에 커밋하지 않는다.
