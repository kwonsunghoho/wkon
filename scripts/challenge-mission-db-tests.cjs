const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const file = path.resolve(
  __dirname,
  "../supabase/migrations/20261126105000_challenge_room_midnight.sql",
);
const uuid = () => crypto.randomUUID();
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;
create role authenticated;
create role service_role bypassrls;
create schema net;
create schema vault;
create schema cron;
create schema auth;
create schema storage;
create schema monc_community;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated;
create table public.members(id uuid primary key,agreed_at timestamptz,role text);
create function public.is_admin() returns bool language sql stable security definer set search_path='' as $$select exists(select from public.members where id=auth.uid() and role='admin')$$;
create table monc_community.profiles(user_id uuid,nickname text);
create table public.challenge_rounds(id uuid primary key,challenge text,round integer,program_start date);
create table public.applications(id uuid primary key default gen_random_uuid(),member_id uuid,paid bool,payment_status text,refunded bool,challenges jsonb);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant insert,select,delete on storage.objects to authenticated;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds int default 5000) returns bigint language sql as $$select 1::bigint$$;`);
    await db.exec(fs.readFileSync(file, "utf8"));
    const q = async (sql, p) => (await db.query(sql, p)).rows;
    const one = async (sql, p) => (await q(sql, p))[0];
    const rpc = async (ac, data = {}) =>
      (await one("select public.challenge_room($1,$2::jsonb) as v", [
        ac,
        JSON.stringify(data),
      ])).v;
    const perms = await one(
      "select not has_function_privilege('anon','public.challenge_room(text,jsonb)','execute') as anon,not has_schema_privilege('authenticated','challenge_room_data','usage') as priv,not has_function_privilege('authenticated','public.challenge_push_worker(text,jsonb)','execute') as queue,not has_function_privilege('authenticated','challenge_room_data.history(uuid)','execute') as hist",
    );
    assert.deepEqual(Object.values(perms), [true, true, true, true]);
    const admin = uuid(),
      member = uuid(),
      peer = uuid(),
      partial = uuid(),
      outsider = uuid(),
      noconsent = uuid(),
      refunded = uuid(),
      cancelled = uuid(),
      cohort = uuid(),
      wrong = uuid(),
      noCourse = uuid();
    async function role(uid) {
      await db.exec("reset role");
      await q("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
      await db.exec("set role authenticated");
    }
    async function root() {
      await db.exec("reset role");
    }
    for (
      const [id, role] of [
        [admin, "admin"],
        [member, "member"],
        [peer, "member"],
        [partial, "member"],
        [outsider, "member"],
        [noconsent, "member"],
        [refunded, "member"],
        [cancelled, "member"],
      ]
    ) {
      await q(
        "insert into public.members values($1,case when $2 then now() end,$3)",
        [id, id !== noconsent, role],
      );
    }
    for (
      const [id, round, challenge] of [[cohort, 6, "voice"], [
        wrong,
        5,
        "voice",
      ], [noCourse, 6, "spinning"]]
    ) {
      await q("insert into public.challenge_rounds values($1,$2,$3,null)", [
        id,
        challenge,
        round,
      ]);
    }
    for (
      const [uid, p, status, refund, r] of [
        [member, true, "pending", false, 6],
        [peer, false, "free", false, 6],
        [partial, false, "partial_refunded", false, 6],
        [outsider, true, "paid", false, 5],
        [refunded, true, "paid", true, 6],
        [cancelled, true, "failed", false, 6],
      ]
    ) {
      await q(
        "insert into public.applications(member_id,paid,payment_status,refunded,challenges) values($1,$2,$3,$4,$5)",
        [
          uid,
          p,
          status,
          refund,
          JSON.stringify([{ challenge: "voice", round: r }]),
        ],
      );
    }
    const dates = await one(
      "select (date_trunc('week',now() at time zone 'Asia/Seoul')::date-7)::text as past, (date_trunc('week',now() at time zone 'Asia/Seoul')::date+7)::text as future,(date_trunc('week',now() at time zone 'Asia/Seoul')::date+8)::text as future2,(date_trunc('week',now() at time zone 'Asia/Seoul')::date+12)::text as sat",
    );
    const nowMission = uuid();
    await q(
      "insert into challenge_room_data.missions(id,round_id,day_no,release_date,title,body) values($1,$2,1,$3,'시작','오늘 과제')",
      [nowMission, cohort, dates.past],
    );
    const scope = { challenge: "voice", round: 6 },
      spec = {
        ...scope,
        day_no: 2,
        title: "미래 비공개 제목",
        body: "미래 비공개 내용",
        release_date: dates.future,
      };
    await role(admin);
    const { id: future } = await rpc("admin-save", spec);
    await assert.rejects(
      () => rpc("admin-save", { ...spec, day_no: 3 }),
      /duplicate_schedule/,
    );
    await assert.rejects(
      () => rpc("admin-save", { ...spec, day_no: 3, release_date: dates.sat }),
      /bad_schedule/,
    );
    await assert.rejects(
      () => rpc("admin-delete", { id: nowMission }),
      /locked/,
    );
    await assert.rejects(
      () =>
        rpc("admin-save", {
          ...spec,
          id: nowMission,
          day_no: 1,
          release_date: dates.future2,
        }),
      /locked/,
    );
    const future2 = await rpc("admin-save", {
      ...spec,
      day_no: 3,
      release_date: dates.future2,
    });
    await rpc("admin-delete", future2);
    const listing = await rpc("admin-list", scope);
    assert.equal(listing.missions.length, 2);
    const timing = await one(
      "select ((($1::date::timestamp at time zone 'Asia/Seoul') at time zone 'UTC')::time='15:00') as cutoff",
      [dates.future],
    );
    assert(timing.cutoff);
    assert.equal(new Date(listing.missions[1].opens_at).getUTCHours(), 15);
    await role(outsider);
    assert.equal((await rpc("home")).cohorts.length, 0);
    await assert.rejects(() => rpc("admin-list", scope), /forbidden/);
    await assert.rejects(() => rpc("mission", { id: nowMission }), /not_found/);
    for (const uid of [refunded, cancelled]) {
      await role(uid);
      await assert.rejects(
        () => rpc("mission", { id: nowMission }),
        /not_found/,
      );
    }
    await role(noconsent);
    await assert.rejects(() => rpc("home"), /forbidden/);
    await role(partial);
    assert.equal((await rpc("home")).cohorts[0].missions.length, 1);
    await role(member);
    const home = await rpc("home");
    assert.equal(home.cohorts.length, 1);
    assert(!JSON.stringify(home).includes("미래"));
    await assert.rejects(() => rpc("mission", { id: future }), /not_found/);
    await assert.rejects(
      () => rpc("submit", { id: future, body: "x", request_id: uuid() }),
      /not_found/,
    );
    const saved = {
        id: nowMission,
        body: "연습 내용",
        request_id: uuid(),
        shared: false,
      },
      ans = await rpc("submit", saved);
    assert.equal((await rpc("submit", saved)).id, ans.id);
    await assert.rejects(
      () => rpc("submit", { ...saved, body: "changed" }),
      /already_submitted/,
    );
    await assert.rejects(
      () => rpc("comment", { id: ans.id, body: "me", request_id: uuid() }),
      /forbidden/,
    );
    await role(peer);
    assert.equal((await rpc("mission", { id: nowMission })).answers.length, 0);
    await assert.rejects(
      () => rpc("comment", { id: ans.id, body: "peer", request_id: uuid() }),
      /forbidden/,
    );
    await role(member);
    await rpc("share", { id: ans.id, shared: true });
    await role(peer);
    assert.equal((await rpc("mission", { id: nowMission })).answers.length, 1);
    const nc = { id: ans.id, body: "피드백", request_id: uuid() },
      note = await rpc("comment", nc);
    assert.equal((await rpc("comment", nc)).id, note.id);
    await assert.rejects(
      () => rpc("comment", { ...nc, request_id: uuid() }),
      /already_commented/,
    );
    const audio = uuid(),
      audioPath = peer + "/" + nowMission + "/" + audio + ".webm";
    await assert.rejects(
      () =>
        rpc("submit", {
          id: nowMission,
          file_id: audio,
          extension: "webm",
          request_id: audio,
        }),
      /audio_missing/,
    );
    await assert.rejects(
      () =>
        q(
          "insert into storage.objects(bucket_id,name) values('challenge-room-audio',$1)",
          [member + "/" + nowMission + "/" + audio + ".webm"],
        ),
      (e) => e.code === "42501",
    );
    await assert.rejects(
      () =>
        q(
          "insert into storage.objects(bucket_id,name) values('challenge-room-audio',$1)",
          [peer + "/" + future + "/" + audio + ".webm"],
        ),
      (e) => e.code === "42501",
    );
    await q(
      "insert into storage.objects(bucket_id,name) values('challenge-room-audio',$1)",
      [audioPath],
    );
    const audioAns = await rpc("submit", {
      id: nowMission,
      file_id: audio,
      extension: "webm",
      request_id: audio,
    });
    await q("delete from storage.objects where name=$1", [audioPath]);
    assert.equal(
      (await q("select id from storage.objects where name=$1", [audioPath]))
        .length,
      1,
    );
    await role(member);
    assert.equal(
      (await q("select id from storage.objects where name=$1", [audioPath]))
        .length,
      0,
    );
    const hist = await rpc("history");
    assert.equal(hist.history[0].comment_count, 1);
    await role(peer);
    await rpc("share", { id: audioAns.id, shared: true });
    await role(member);
    assert.equal(
      (await q("select id from storage.objects where name=$1", [audioPath]))
        .length,
      1,
    );
    await root();
    await q("update public.applications set refunded=true where member_id=$1", [
      member,
    ]);
    await role(member);
    assert.equal(
      (await q("select id from storage.objects where name=$1", [audioPath]))
        .length,
      0,
    );
    assert.equal((await rpc("mission", { id: nowMission })).answers.length, 1);
    assert.equal((await rpc("history")).history.length, 1);
    await rpc("share", { id: ans.id, shared: false });
    await assert.rejects(
      () => rpc("share", { id: ans.id, shared: true }),
      /forbidden/,
    );
    const c = crypto.createECDH("prime256v1"),
      pub = c.generateKeys().toString("base64url"),
      auth = crypto.randomBytes(16).toString("base64url");
    const reg = {
      ...scope,
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: pub, auth },
    };
    await role(peer);
    assert.equal((await rpc("push-status", reg)).enabled, false);
    await assert.rejects(
      () =>
        rpc("push-enable", { ...reg, endpoint: "https://example.org/capture" }),
      /invalid_input/,
    );
    await assert.rejects(
      () => rpc("push-enable", { ...reg, keys: { p256dh: pub, auth: "x" } }),
      /invalid_input/,
    );
    await assert.rejects(
      () =>
        rpc("push-enable", {
          ...reg,
          keys: { ...reg.keys, p256dh: "Bz" + pub.slice(2) },
        }),
      /invalid_input/,
    );
    await assert.rejects(
      () =>
        rpc("push-enable", {
          ...reg,
          keys: { ...reg.keys, auth: auth.slice(0, -1) + "B" },
        }),
      /invalid_input/,
    );
    const windows = {
      ...reg,
      endpoint: "https://db5.wns.windows.com/w/?token=synthetic",
    };
    assert.equal((await rpc("push-enable", windows)).enabled, true);
    await rpc("push-disable", windows);
    assert.equal((await rpc("push-enable", reg)).enabled, true);
    assert.equal((await rpc("push-enable", reg)).enabled, true);
    assert.equal((await rpc("push-status", reg)).enabled, true);
    await role(partial);
    await rpc("push-enable", reg);
    await role(peer);
    assert.equal((await rpc("push-status", reg)).enabled, false);
    await rpc("push-disable", reg);
    await role(partial);
    assert.equal((await rpc("push-status", reg)).enabled, true);
    await rpc("push-disable", reg);
    assert.equal((await rpc("push-status", reg)).enabled, false);
    console.log(
      "PASS combined production migration; guest/private ACL, admin create/locked/delete, KST future, scoped rounds, excluded refunded/failed, free/manual/partial, private/shared/text/audio submits, storage RLS, feedback + idempotency, own archive after refund, per-device opt-in and owner transfer",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.code || "", e.where || "");
  process.exit(1);
});
