# MONC 로고 풀 패키지

제공받은 원본 **1672×941px PNG**를 기준으로 홈페이지·SNS·앱 준비용 파일을 정리했습니다.

## 가장 먼저 사용할 파일

- 홈페이지 헤더: `assets/web/monc-logo-transparent-640.webp`
- 홈페이지 큰 배너: `assets/svg/monc-logo-exact-transparent.svg`
- PNG 원본급: `assets/master/monc-wordmark-native-transparent.png`
- 아이보리 배경형: `assets/master/monc-wordmark-native-on-ivory.png`
- 파비콘: `assets/favicon/favicon.ico`
- 앱 아이콘: `assets/social/monc-app-icon-1024x1024.png`
- SNS 프로필: `assets/social/monc-profile-o-1080x1080.png`
- 카카오톡·SNS 공유: `assets/social/monc-og-image-1200x630.png`
- 적용 예시: 루트의 `index.html`

## 폴더 구성

- `assets/master` — 원본, 투명 배경, 2배·4배 확대본
- `assets/web` — 반응형 PNG/WebP 320~2260px
- `assets/svg` — 정확한 외형의 SVG 래퍼, 단색 실제 벡터
- `assets/favicon` — 파비콘, 애플 터치 아이콘, PWA 아이콘·manifest
- `assets/social` — SNS 프로필, OG 이미지, 앱 아이콘, 이메일 서명
- `brand` — 브랜드 컬러 CSS·JSON
- `css` — 반응형 로고 CSS
- `snippets` — 복사해서 붙이는 HTML 코드

## HTML 적용

### 1. 간단 적용

```html
<img
  src="/assets/svg/monc-logo-exact-transparent.svg"
  width="1130"
  height="335"
  alt="MONC"
>
```

### 2. 반응형 WebP + PNG 폴백

`snippets/responsive-logo.html` 내용을 복사해 사용하세요.

### 3. 파비콘

`snippets/favicon-head.html` 내용을 `<head>` 안에 넣으세요.

## 브랜드 컬러

- MONC Navy: `#102B56`
- MONC Ivory: `#F6EEE8`
- Sunset Peach: `#F8DEC8`
- Sky Lavender: `#B7B5CE`
- Cloud Mauve: `#A99CA5`

## 화질 안내

- `native` 파일은 제공된 원본에서 로고 영역을 손실 없이 잘라낸 기준본입니다.
- `2x`, `4x`는 큰 화면·목업 편의를 위한 고급 리샘플 확대본입니다.
- `monc-logo-exact-*.svg`는 브라우저 적용이 편하도록 **PNG를 SVG 안에 포함한 정확한 외형 파일**입니다.
- `monc-logo-monochrome-vector.svg`는 실제 벡터지만, 자동 트레이싱 단색본이라 창문 속 하늘 이미지는 포함하지 않습니다.
- 완전한 인쇄용 원본 벡터(AI/EPS)가 필요할 경우에는 로고를 수작업으로 다시 벡터화해야 합니다.

## 사용 기준

- 기본 배경은 MONC Ivory `#F6EEE8` 권장
- 로고의 비율을 임의로 눌러 변형하지 않기
- CSS에서 `width`만 조정하고 `height: auto` 유지
- 작은 파비콘에는 전체 워드마크보다 O 아이콘 사용
