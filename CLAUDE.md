# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MONC (몬크 챌린지) — a Korean landing site for a 2-week voice/expression/interview training program aimed at airline cabin crew applicants. It is a **static site with no build step**, hosted on GitHub Pages at https://kwonsunghoho.github.io/wkon/. There is no framework, bundler, package.json, or test suite — just hand-written HTML/CSS/JS files served as-is.

## Commands

- **Local preview**: `python -m http.server 5500` then open `http://localhost:5500/`. (A `.claude/launch.json` defines a `wkon-static` server for the preview tooling.)
- **Deploy**: `git push origin main` — GitHub Pages serves `main` directly. There is nothing to build; a push *is* the deploy. Allow 1–2 minutes for propagation.
- **No lint/test commands exist.** Verify changes by rendering in a browser.

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch. The canonical checkout is the repo root on `main`; make sure work lands on `main`.

## Backend: there is no server

All "backend" behavior is **Google Apps Script** + **published Google Sheets**, called directly from the browser. Two independent data sources:

1. **Applications & reviews** — `APPLICATION_API_URL` (Apps Script web app).
   - `POST {action:"application", ...}` → appends/updates a row in the **학생현황** sheet (one row per student, keyed by phone; challenge columns marked "신청"). Phone is stored with a leading apostrophe so Sheets keeps the leading `0`.
   - `GET ?action=reviews` → returns JSON from the **후기** sheet (columns: A=이름, B=후기, C=요약, D=원문 링크).
   - **The Apps Script is owned/edited in Google's console, not in this repo.** Code changes there require the owner to redeploy a *new version* before they take effect.
2. **Recruitment dates** — `RECRUIT_CSV` in `recruit.js`, a *published* Google Sheet CSV (different mechanism from #1). Drives "모집 중 / 모집 예정 / 마감" status and D-day chips.

## Architecture / things that require reading multiple files

### The application modal exists in TWO places — keep them in sync
This is the single biggest footgun. The challenge sign-up modal is implemented twice:

- **`index.html`** has its own inline copy: the modal markup, `submitApplication()`, `copyAccount()`, price/deposit logic, and the bank account info — button class `.modal-btn`.
- **`application-modal.js`** is a *separate, self-injecting* copy used by the detail pages: it injects its own CSS + modal HTML and defines its own `submitApplication()` / `copyAccount()` — button class `.app-modal-btn`.

Any change to pricing, the deposit, the bank account number, the submit/duplicate-guard logic, or the modal fields **must be made in both files**. `APPLICATION_API_URL` is also declared independently in each (currently identical — keep them identical).

### Pages
- `index.html` — the landing page. Large and self-contained: design tokens, all sections, the inline modal, review loading, and most JS live here.
- Active detail pages (linked from the index cards, each loads `application-modal.js`): `challenge-voice.html` (보신각), `challenge-expression.html` (영합각), `challenge-spinning.html` (스피닝), `challenge-answer.html` (승자각).
- `challenge-express.html` and `challenge-speech.html` are **legacy/unused** — not linked from the index and do not load the shared modal. Don't edit these assuming they're live.
- `terms.html`, `privacy.html` — legal pages linked from the footer.
- `index.backup-*.html` — manual timestamped backups, not part of the site.

### recruit.js (shared by index + detail pages)
Fetches `RECRUIT_CSV`, falls back to `RECRUIT_FALLBACKS` (and per-card `data-recruit-start/-end` attributes) when the sheet is unavailable. Key entry points:
- `applyIndexRecruit()` — rewrites each `.challenge-card`'s status badge, period text, and D-day chip on the index.
- `applyDetailRecruit(id)` — does the same for a detail page and disables `.apply-btn` when closed.
- `loadChallengeStatuses()` — populates `window._challengeStatuses` so the modal can disable checkboxes for closed/upcoming challenges.
Each challenge's identity is the `data-recruit-id` (`voice` / `expression` / `spinning` / `answer`), used consistently across cards, fallbacks, and the sheet.

### Reviews on the index
`loadReviews()` in `index.html` fetches `?action=reviews`, renders a horizontally-scrolling marquee, and caches results in `localStorage` under `monc_reviews_v1` (shown instantly on repeat visits, refreshed in the background).

### Design system (index.html `:root`)
The index defines the design tokens; **detail pages each carry their own inline `:root`** and do not share the index's variables. Core conventions:
- **Pink (`--primary` #D63384) is the brand color; teal (`--action` #0C8091) is reserved exclusively for conversion CTAs** (신청/시작/참여) via `.btn-action`. If something is teal, it means "this submits an application." Don't use teal for decoration.
- Typography (`--fs-*`), spacing (`--space-*`, 8px scale), radius scale (8/14/20/24), and section background rhythm (alternating white / light-pink, with the final CTA band in teal tint) are all tokenized. Prefer tokens over hardcoded values.
- Icons are inline SVG `<symbol>`s in a sprite at the top of `<body>`, recolored via `currentColor`. There is a mobile sticky CTA bar (`.mobile-cta-bar`, shown ≤768px).

### Audio (before/after recordings on detail pages)
`audio/` holds challenger before/after clips referenced by the detail pages. Naming is positional: `challenger-a-before.mp3` … (voice page) and `spinning-a-before.m4a` … (spinning page). Watch for double extensions when files are added on Windows (e.g. `*.mp3.m4a`).

## Conventions
- Commit messages and in-code comments are written in Korean (matching the existing history and content).
