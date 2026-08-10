# vendor/pdfjs — pdf.js 벤더 사본

- 출처: npm `pdfjs-dist` **4.10.38** 의 **legacy 빌드**(구형 폰 지원 폭이 넓다) + `cmaps/` + `standard_fonts/`. 라이선스 Apache-2.0(`LICENSE`).
- 쓰는 곳: `lab-viewer.js`(연구실 자료 읽기 화면) 하나뿐. **읽기 화면을 처음 여는 순간에만 로드**되므로 다른 페이지 전송량 영향 없음.
- 전송 실측(2026-08-10, gzip): `pdf.min.mjs` 398KB→**114KB**, `pdf.worker.min.mjs` 1,417KB→**416KB**. 첫 열람 합계 약 530KB. `cmaps/`·`standard_fonts/`는 특정 PDF 가 필요로 할 때만 낱개로 받아간다.
- 갱신법: 새 tarball(`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-<버전>.tgz`)에서 `legacy/build/pdf.min.mjs`·`pdf.worker.min.mjs`·`cmaps`·`standard_fonts`·`LICENSE` 를 같은 자리에 덮고, 이 파일의 버전·실측을 갱신한 뒤 `lab-viewer.js` 를 부르는 `VIEWER_SRC` 의 `?v=` 도 올린다(코어·워커 버전이 서로 어긋나면 pdf.js 가 로드를 거부한다 — 항상 한 벌로 교체).
