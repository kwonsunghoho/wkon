#!/usr/bin/env python3
"""
scripts/fetch-news.mjs 의 필터 규칙을 실제 구글뉴스 RSS 에 대고 검증한다.
이 맥에 node 가 없어 --dry-run 을 못 돌리므로, JS 파일에서 정규식 리터럴을
그대로 읽어와 파이썬으로 실행한다(손으로 옮겨 적지 않으므로 규칙이 어긋날 수 없다).

사용: python3 scripts/verify-news-rules.py [--old]
      --old 을 주면 새 규칙을 끄고 참사 필터만 적용한 '기준선'을 낸다.

⚠️ 규칙을 고치면 '남은 기사'가 아니라 '버린 목록'을 볼 것. 이 필터는 못 걸러서가 아니라
   멀쩡한 기사를 걷어내서 망한다(제외 건수가 크면 잘 걸러진 게 아니라 잘못 걸러진 것이다).
"""
import re, sys, urllib.parse, urllib.request, html
from pathlib import Path
from collections import defaultdict

# Windows 콘솔(cp949)에서 —·○ 같은 문자가 UnicodeEncodeError 로 죽는다 — 출력만 UTF-8 로 고정
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

JS = Path(__file__).resolve().parent / "fetch-news.mjs"
if not JS.exists():
    raise SystemExit(f"{JS} 를 찾지 못했습니다.")
src = JS.read_text(encoding="utf-8")

OLD_ONLY = "--old" in sys.argv


def grab(name):
    """const NAME = /.../flags;  → 컴파일된 파이썬 정규식"""
    m = re.search(r"^const\s+" + name + r"\s*=\s*/(.*?)/([a-z]*);\s*$", src, re.M)
    if not m:
        raise SystemExit(f"{name} 정규식을 찾지 못했습니다.")
    body, flags = m.group(1), m.group(2)
    return re.compile(body, re.I if "i" in flags else 0)


EXCLUDE = grab("EXCLUDE")
RESCUE = grab("RESCUE")
rules = {}
if not OLD_ONLY:
    for n in ("SPORTS", "STOCKS", "BAD_SOURCE", "AVIATION"):
        rules[n] = grab(n)

# AIRLINES 도 JS 에서 읽는다(이름·별칭이 어긋나지 않게)
AIRLINES, AIRLINE_ALIAS = [], []
for m in re.finditer(r"name:\s*'([^']+)'\s*,\s*alias:\s*\[([^\]]+)\]", src):
    name = m.group(1)
    AIRLINES.append((None, name))
    for a in re.findall(r"'([^']+)'", m.group(2)):
        AIRLINE_ALIAS.append((name, a))
if not AIRLINES:
    raise SystemExit("AIRLINES 를 읽지 못했습니다.")
QUERIES = [n for _, n in AIRLINES] + ["항공사 채용", "국내 항공업계"]


def drop_reason(title, source):
    if EXCLUDE.search(title) and not RESCUE.search(title):
        return "참사"
    if OLD_ONLY:
        return None
    if rules["SPORTS"].search(title):
        return "스포츠"
    if rules["STOCKS"].search(title):
        return "시황"
    if rules["BAD_SOURCE"].search(source or "") or rules["BAD_SOURCE"].search(title):
        return "블로그"
    if not rules["AVIATION"].search(title) and not any(
        al in title for _, al in AIRLINE_ALIAS
    ):
        return "항공무관"
    return None


def unescape_xml(s):
    s = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", s)
    return html.unescape(s)


def parse_items(xml):
    out = []
    for m in re.finditer(r"<item>([\s\S]*?)</item>", xml):
        block = m.group(1)

        def tag(name):
            t = re.search(r"<" + name + r"[^>]*>([\s\S]*?)</" + name + r">", block)
            return unescape_xml(t.group(1)).strip() if t else ""

        title, source = tag("title"), tag("source")
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)]
        for _ in range(2):
            m2 = re.search(r" - (\S{1,12})$", title)
            if m2 and len(title) - len(m2.group(0)) >= 10:
                title = title[: -len(m2.group(0))]
            else:
                break
        url, pub = tag("link"), tag("pubDate")
        if title and url:
            out.append({"title": title, "url": url, "source": source or None})
    return out


collected = {}
for q in QUERIES:
    u = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q) + "&hl=ko&gl=KR&ceid=KR:ko"
    try:
        with urllib.request.urlopen(u, timeout=25) as r:
            for it in parse_items(r.read().decode("utf-8", "replace")):
                collected[it["url"]] = it
    except Exception as e:
        print(f"쿼리 실패(스킵): {q} — {e}")

print(f"수집 {len(collected)}건 (쿼리 {len(QUERIES)}개)  규칙={'구(참사만)' if OLD_ONLY else '신(전체)'}")

norm = lambda s: re.sub(r"""[\s\[\]()"'“”‘’·…‥,.?!\-]""", "", s).lower()
drops, kept, seen = defaultdict(list), [], set()
for it in collected.values():
    why = drop_reason(it["title"], it["source"])
    if why:
        drops[why].append(it["title"])
        continue
    k = norm(it["title"])
    if k in seen:
        continue
    seen.add(k)
    kept.append(it)

total_drop = sum(len(v) for v in drops.values())
print(f"제외 {total_drop}건 — " + (" · ".join(f"{w} {len(v)}" for w, v in drops.items()) or "없음"))
for why, lst in drops.items():
    print(f"\n── 제외: {why} ({len(lst)}건) ──────────────")
    for t in lst[:10]:
        print("  ✗", t[:105])
    if len(lst) > 10:
        print(f"  … 외 {len(lst)-10}건")

print(f"\n── 남은 기사 (상위 25건) ──────────────")
for it in kept[:25]:
    print("  ○", it["title"][:100], f"({it['source']})")
print(f"\n결과: 저장 대상 {len(kept)}건 / 수집 {len(collected)}건")
