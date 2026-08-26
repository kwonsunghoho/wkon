-- 역량검사 게임 회원 점수 기록 (2026-08-26 오너 지시 "회원 점수 기록도 만들어")
-- 기기 localStorage(monc_games_v1)는 그대로 본체 — 로그인 상태면 서버 기록을 병행한다.
-- 쓰기는 RPC(save_game_score)만: 최고점 병합(greatest)을 클라이언트가 우회하지 못하게
-- 직접 INSERT/UPDATE 정책은 열지 않는다. 읽기는 본인 행만.

create table if not exists public.game_scores (
  member_id  uuid not null references auth.users (id) on delete cascade,
  game       text not null check (game in ('nback','rps','path','rotate','yaksok','numbers','compare')),
  kind       text not null check (kind in ('real','practice')),
  best       integer not null default 0 check (best >= 0 and best <= 100000),
  plays      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (member_id, game, kind)
);

alter table public.game_scores enable row level security;

drop policy if exists game_scores_select_own on public.game_scores;
create policy game_scores_select_own on public.game_scores
  for select to authenticated
  using (member_id = auth.uid());

create or replace function public.save_game_score(p_game text, p_kind text, p_score integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_game is null or p_game not in ('nback','rps','path','rotate','yaksok','numbers','compare') then
    raise exception 'bad game';
  end if;
  if p_kind is null or p_kind not in ('real','practice') then
    raise exception 'bad kind';
  end if;
  if p_score is null or p_score < 0 or p_score > 100000 then
    raise exception 'bad score';
  end if;

  insert into public.game_scores (member_id, game, kind, best, plays)
  values (auth.uid(), p_game, p_kind, p_score, 1)
  on conflict (member_id, game, kind) do update
    set best       = greatest(public.game_scores.best, excluded.best),
        plays      = public.game_scores.plays + 1,
        updated_at = now();
end;
$$;

revoke all on function public.save_game_score(text, text, integer) from public;
grant execute on function public.save_game_score(text, text, integer) to authenticated;
