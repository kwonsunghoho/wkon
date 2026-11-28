const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const migration = (filename) =>
  path.resolve(
    __dirname,
    "../supabase/migrations",
    filename,
  );
const uuid = () => crypto.randomUUID();
(async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, "fixtures/challenge-room-schema.sql"), "utf8"));
    await db.exec(
      fs.readFileSync(
        migration("20261126105000_challenge_room_midnight.sql"),
        "utf8",
      ),
    );
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
    // This opened, text-only mission predates the weekly video migration.
    await db.exec(
      fs.readFileSync(
        migration("20261127090000_challenge_mission_weekly_chapters.sql"),
        "utf8",
      ),
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
    const weeklyIds = ["WeeklyQA001", "WeeklyQA002"];
    const watch = (videoId) => "https://www.youtube.com/watch?v=" + videoId;
    const weekVideo = (week_no, video_url) =>
      rpc("admin-week-save", { ...scope, week_no, video_url });
    const adminList = () => rpc("admin-list", scope);
    const chapter = { chapter_start_seconds: 0, chapter_end_seconds: 90 };
    const linkedDay = { ...spec, id: future, release_date: dates.future2 };
    const editDay = (fields) => rpc("admin-save", { ...linkedDay, ...fields });
    async function adminDay(id) {
      return (await adminList()).missions.find((mission) => mission.id === id);
    }
    function assertNoVideo(data) {
      // An optional null chapter is fine. Neither source nor segment may survive.
      const serialized = JSON.stringify(data);
      assert.doesNotMatch(serialized, /WeeklyQA00[12]|youtube|youtu\.be/i);
      assert.doesNotMatch(
        serialized,
        /"(?:video_id|video_url|(?:chapter_)?(?:start|end)_seconds)"/,
      );
    }
    async function assertServerTime() {
      const before = (await one("select clock_timestamp() as t")).t;
      const home = await rpc("home");
      const after = (await one("select clock_timestamp() as t")).t;
      const actual = Date.parse(home.server_now);
      assert.ok(
        actual >= new Date(before).getTime() &&
          actual <= new Date(after).getTime(),
      );
      assertNoVideo(home);
      return home;
    }

    await root();
    const privateGrants = await q(`
      select role_name, f.proname
      from pg_proc f
      cross join (values ('anon'),('authenticated')) as roles(role_name)
      where f.pronamespace='challenge_room_data'::regnamespace
        and has_function_privilege(role_name, f.oid, 'execute')
    `);
    assert.deepEqual(privateGrants, []);
    assert.deepEqual(
      await q(`
      select role_name, t.relname
      from pg_class t
      cross join (values ('anon'),('authenticated')) as roles(role_name)
      where t.relnamespace='challenge_room_data'::regnamespace
        and t.relkind in ('r','v') and has_table_privilege(role_name, t.oid, 'select')
    `),
      [],
    );
    await db.exec("set role anon");
    await assert.rejects(
      () => rpc("admin-list", scope),
      (error) => error.code === "42501",
    );
    await role(peer);
    await assert.rejects(() => weekVideo(1, weeklyIds[0]), /forbidden/);
    await assert.rejects(() => editDay(chapter), /forbidden/);
    const legacy = await rpc("mission", { id: nowMission });
    assert.ok(legacy.mission.eligible);
    assertNoVideo(legacy);
    assert.equal(legacy.mission.chapter ?? null, null);

    await role(admin);
    assert.deepEqual((await adminList()).week_videos, []);
    const existing = await adminDay(nowMission);
    assert.equal(existing.chapter_start_seconds, null);
    assert.equal(existing.chapter_end_seconds, null);
    await assert.rejects(() => editDay(chapter), /week_video_missing/);
    for (const invalid of [0, 3]) {
      await assert.rejects(
        () => weekVideo(invalid, weeklyIds[0]),
        /invalid_input/,
      );
    }
    for (
      const invalid of [
        "https://example.org/watch?v=" + weeklyIds[0],
        "https://www.youtube.com.example.org/watch?v=" + weeklyIds[0],
        "https://youtu.be/short",
        "incomplete",
      ]
    ) {
      await assert.rejects(() => weekVideo(1, invalid), /bad_video/);
    }
    for (
      const source of [
        watch(weeklyIds[0]),
        "https://youtu.be/" + weeklyIds[0],
        "https://www.youtube.com/embed/" + weeklyIds[0],
        weeklyIds[0],
      ]
    ) {
      await weekVideo(1, source);
      const registered = (await adminList()).week_videos;
      assert.equal(registered.length, 1);
      assert.equal(registered[0].week_no, 1);
      assert.equal(registered[0].video_url, watch(weeklyIds[0]));
      assert.equal(registered[0].locked, false);
    }
    await weekVideo(2, weeklyIds[1]);
    for (
      const fields of [
        { chapter_start_seconds: 0 },
        { chapter_start_seconds: null, chapter_end_seconds: 1 },
        { chapter_start_seconds: -1, chapter_end_seconds: 90 },
        { chapter_start_seconds: 5, chapter_end_seconds: 5 },
        { chapter_start_seconds: 7, chapter_end_seconds: 6 },
        { chapter_start_seconds: 0, chapter_end_seconds: 86401 },
        { chapter_start_seconds: 0.5, chapter_end_seconds: 4 },
      ]
    ) {
      await assert.rejects(() => editDay(fields), /bad_chapter/);
    }
    await assert.rejects(
      () => editDay({ ...chapter, release_date: dates.future }),
      /bad_chapter_day/,
    );
    await editDay({ ...chapter, chapter_end_seconds: 86400 });
    await editDay({ title: "Retitled legacy editor request" });
    assert.equal((await adminDay(future)).chapter_start_seconds, 0);
    assert.equal((await adminDay(future)).chapter_end_seconds, 86400);
    await editDay({ chapter_start_seconds: null, chapter_end_seconds: null });
    assert.equal((await adminDay(future)).chapter_start_seconds, null);
    assert.equal((await adminDay(future)).chapter_end_seconds, null);
    await editDay(chapter);
    const { wed, fri } = await one(
      "select ($1::date+2)::text as wed,($1::date+4)::text as fri",
      [dates.future],
    );
    const friday = await rpc("admin-save", {
      ...spec,
      day_no: 5,
      release_date: fri,
      chapter_start_seconds: 130,
      chapter_end_seconds: 155,
    });
    const wednesday = {
      ...spec,
      day_no: 3,
      title: "Wednesday chapter",
      release_date: wed,
    };
    const saveWednesday = (start, end, fields = {}) =>
      rpc("admin-save", {
        ...wednesday,
        chapter_start_seconds: start,
        chapter_end_seconds: end,
        ...fields,
      });
    // Day 3 must fit after Day 2 and before Day 5, even when Day 4 is unassigned.
    for (const [start, end] of [[89, 110], [100, 131], [160, 170], [0, 10]]) {
      await assert.rejects(
        () => saveWednesday(start, end),
        /challenge_room:chapter_order/,
      );
    }
    assert.ok(!(await adminList()).missions.some((day) => day.day_no === 3));
    const fit = await saveWednesday(90, 130);
    const original = await adminDay(fit.id);
    await assert.rejects(
      () => saveWednesday(91, 132, { id: fit.id, title: "Must roll back" }),
      /challenge_room:chapter_order/,
    );
    assert.deepEqual(await adminDay(fit.id), original);
    // A gap is valid on either side of the Wednesday entry.
    await saveWednesday(99, 123, { id: fit.id });
    assert.equal((await adminDay(fit.id)).chapter_start_seconds, 99);
    assert.equal((await adminDay(friday.id)).chapter_start_seconds, 130);
    const weekTwoDay = await rpc("admin-save", {
      ...spec,
      day_no: 6,
      chapter_start_seconds: 90,
      chapter_end_seconds: 180,
    });
    const otherCohort = await rpc("admin-list", { ...scope, round: 5 });
    assert.deepEqual(otherCohort.week_videos, []);
    assert.deepEqual(otherCohort.missions, []);
    // The same Wednesday may use an overlapping segment in a separate cohort.
    await rpc("admin-week-save", {
      ...scope,
      round: 5,
      week_no: 1,
      video_url: weeklyIds[1],
    });
    const otherDay = await saveWednesday(10, 140, { round: 5 });
    assert.ok(otherDay.id);

    await role(peer);
    const upcoming = await assertServerTime();
    assert.ok(!JSON.stringify(upcoming).includes(future));
    assert.ok(!JSON.stringify(upcoming).includes(weekTwoDay.id));
    await assert.rejects(() => rpc("mission", { id: future }), /not_found/);
    await assert.rejects(
      () => rpc("mission", { id: weekTwoDay.id }),
      /not_found/,
    );
    await root();
    // Simulate Tuesday's opening without changing the production clock or RPC.
    await q(
      "update challenge_room_data.missions set release_date=$1::date+1 where id=$2",
      [
        dates.past,
        future,
      ],
    );
    await role(peer);
    const opened = await rpc("mission", { id: future });
    assert.deepEqual(opened.mission.chapter, {
      provider: "youtube",
      video_id: weeklyIds[0],
      start_seconds: 0,
      end_seconds: 90,
      week_no: 1,
    });
    const afterRelease = await assertServerTime();
    assert.ok(
      afterRelease.cohorts[0].missions.some((mission) => mission.id === future),
    );
    assertNoVideo(await rpc("mission", { id: nowMission }));
    await rpc("submit", {
      id: future,
      body: "My Tuesday note",
      request_id: uuid(),
    });
    const eligibleHistory = await rpc("history");
    assert.ok(
      eligibleHistory.history.some((entry) => entry.mission_id === future),
    );
    assertNoVideo(eligibleHistory);

    await role(admin);
    const byWeek = (await adminList()).week_videos;
    assert.equal(byWeek.find((row) => row.week_no === 1).locked, true);
    assert.equal(byWeek.find((row) => row.week_no === 2).locked, false);
    await assert.rejects(() => weekVideo(1, weeklyIds[1]), /locked/);
    await assert.rejects(
      () => editDay({ ...chapter, chapter_end_seconds: 80 }),
      /locked/,
    );
    await assert.rejects(() => rpc("admin-delete", { id: future }), /locked/);
    await weekVideo(2, weeklyIds[0]);
    assert.equal(
      (await adminList()).week_videos.find((week) => week.week_no === 2)
        .video_url,
      watch(weeklyIds[0]),
    );
    await weekVideo(2, weeklyIds[1]);
    const finalDay = await adminDay(future);
    assert.equal(finalDay.chapter_start_seconds, 0);
    assert.equal(finalDay.chapter_end_seconds, 90);

    await root();
    await q(
      "update challenge_room_data.missions set release_date=$1::date-7 where id=$2",
      [
        dates.past,
        weekTwoDay.id,
      ],
    );
    await role(peer);
    const secondWeek = await rpc("mission", { id: weekTwoDay.id });
    assert.deepEqual(secondWeek.mission.chapter, {
      provider: "youtube",
      video_id: weeklyIds[1],
      start_seconds: 90,
      end_seconds: 180,
      week_no: 2,
    });
    await role(outsider);
    await assert.rejects(() => rpc("mission", { id: future }), /not_found/);
    await root();
    await q("update public.applications set refunded=true where member_id=$1", [
      peer,
    ]);
    await role(peer);
    const archive = await rpc("mission", { id: future });
    assert.equal(archive.mission.eligible, false);
    assert.ok(
      archive.answers.some((answer) =>
        answer.mine && answer.body === "My Tuesday note"
      ),
    );
    assertNoVideo(archive);
    assertNoVideo(await rpc("history"));
    assert.deepEqual((await assertServerTime()).cohorts, []);

    // Upgrade a cohort with a scheduled YouTube chapter, then replace its original before release.
    await root();
    await db.exec(fs.readFileSync(migration("20261127110000_challenge_week_video_storage.sql"), "utf8"));
    const media = async (user, action, data) =>
      (await one("select public.challenge_video_media($1,$2,$3::jsonb) as v", [user, action, JSON.stringify(data)])).v;
    const target = { challenge: "voice", round: 5, week_no: 1 };
    const file = { ...target, name: "보신각 1주차.mp4", size: 4096, contentType: "video/mp4" };
    const videoBucket = "challenge-room-video";
    const writeObject = (intent, size = file.size) => q(
      "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)",
      [videoBucket, intent.path, JSON.stringify({ size, mimetype: file.contentType })],
    );
    assert.deepEqual(await one("select public,file_size_limit::text,allowed_mime_types from storage.buckets where id=$1", [videoBucket]), {
      public: false, file_size_limit: "2147483648", allowed_mime_types: ["video/mp4", "video/webm"],
    });
    const mediaGrants = await one(`select has_function_privilege('anon','public.challenge_video_media(uuid,text,jsonb)','EXECUTE') anon,
      has_function_privilege('authenticated','public.challenge_video_media(uuid,text,jsonb)','EXECUTE') member,
      has_function_privilege('service_role','public.challenge_video_media(uuid,text,jsonb)','EXECUTE') service`);
    assert.deepEqual(mediaGrants, { anon: false, member: false, service: true });
    const edgeRole = async () => {
      await root();
      await db.exec("set role service_role");
    };
    await role(admin);
    assert.equal((await rpc("admin-list", target)).week_videos[0].video_url, watch(weeklyIds[1]));
    await assert.rejects(() => media(admin, "admin-upload", file), error => error.code === "42501");
    await edgeRole();
    await assert.rejects(() => media(outsider, "admin-upload", file));
    await assert.rejects(() => media(admin, "admin-upload", { ...file, size: 2147483649 }));
    await assert.rejects(() => media(admin, "admin-upload", { ...file, contentType: "image/png" }));
    const first = await media(admin, "admin-upload", file);
    await assert.rejects(() => media(admin, "admin-commit", { upload_id: first.upload_id }));
    await root();
    await writeObject(first, file.size - 1);
    await edgeRole();
    await assert.rejects(() => media(admin, "admin-commit", { upload_id: first.upload_id }));
    await media(admin, "admin-cancel", { upload_id: first.upload_id });
    await role(admin);
    assert.equal((await rpc("admin-list", target)).week_videos[0].video_url, watch(weeklyIds[1]));
    await edgeRole();
    const competing = await media(admin, "admin-upload", { ...file, name: "다른 업로드.mp4" });
    const good = await media(admin, "admin-upload", file);
    await root();
    await writeObject(competing);
    await writeObject(good);
    await edgeRole();
    await media(admin, "admin-commit", { upload_id: good.upload_id });
    await media(admin, "admin-commit", { upload_id: good.upload_id });
    await assert.rejects(() => media(admin, "admin-commit", { upload_id: competing.upload_id }));
    assert.equal((await media(admin, "admin-preview", target)).path, good.path);
    await assert.rejects(() => media(outsider, "admin-preview", target));
    await assert.rejects(() => media(outsider, "play", { id: otherDay.id }));
    await role(admin);
    const registered = (await rpc("admin-list", target)).week_videos[0];
    assert.equal(registered.provider, "storage");
    assert.equal(registered.file_name, file.name);
    assert.equal(registered.locked, false);
    await root();
    await q("update challenge_room_data.missions set release_date=$1::date+2 where id=$2", [dates.past, otherDay.id]);
    await edgeRole();
    assert.equal((await media(outsider, "play", { id: otherDay.id })).path, good.path);
    await assert.rejects(() => media(partial, "play", { id: otherDay.id }));
    await assert.rejects(() => media(admin, "admin-upload", file));
    await role(outsider);
    assert.deepEqual((await rpc("mission", { id: otherDay.id })).mission.chapter, {
      provider: "storage", week_no: 1, start_seconds: 10, end_seconds: 140,
    });
    assert.deepEqual(await q("select name from storage.objects where bucket_id=$1", [videoBucket]), []);
    await root();
    await q("update public.applications set refunded=true where member_id=$1", [outsider]);
    await edgeRole();
    await assert.rejects(() => media(outsider, "play", { id: otherDay.id }));
    console.log("PASS private weekly upload, legacy migration, admin/service ACLs, file type/size/actual bytes, cancel/retry, scheduled access, release lock and refund");

    const replaced = await media(admin, "admin-upload", { ...file, week_no: 2 });
    await root();
    await writeObject(replaced);
    await edgeRole();
    await media(admin, "admin-commit", { upload_id: replaced.upload_id });
    await role(admin);
    await rpc("admin-week-save", { ...target, week_no: 2, video_url: weeklyIds[0] });
    const sweep = async (action, data) =>
      (await one("select public.challenge_video_cleanup($1,$2::jsonb) as v", [action, JSON.stringify(data)])).v;
    const claimWithNewTicket = async () => {
      const token = uuid();
      await root();
      await q("insert into challenge_room_data.video_cleanup_tickets values (sha256(convert_to($1,'UTF8')),now()+interval '3 minutes')", [token]);
      await edgeRole();
      const {jobs} = await sweep("claim", {token});
      return {jobs, token};
    };
    await assert.rejects(() => sweep("claim", {token:uuid()}), e => e.code==="42501");
    await root();
    await db.exec("update challenge_room_data.video_uploads set expires_at=now()-interval '2 hours'");
    const recent = await claimWithNewTicket();
    assert.deepEqual(recent.jobs, []);
    await assert.rejects(() => sweep("claim", {token:recent.token}), /invalid_ticket/);
    await root();
    await db.exec("update challenge_room_data.video_uploads set expires_at=now()-interval '2 days'");
    const expired = await claimWithNewTicket();
    assert.deepEqual(expired.jobs.map(job=>job.id).sort(), [first.upload_id, competing.upload_id, replaced.upload_id].sort());
    const cancelledJob = expired.jobs.find(job=>job.id===first.upload_id);
    assert.deepEqual(await sweep("finish",{...cancelledJob, lease:uuid(), success:true}), {ok:false});
    assert.deepEqual(await sweep("finish",{...cancelledJob, success:false}), {ok:true});
    const pending = expired.jobs.find(job=>job.id===competing.upload_id);
    assert.deepEqual(await sweep("finish",{...pending, success:true}), {ok:true});
    assert.deepEqual((await claimWithNewTicket()).jobs, []);
    await root();
    await q("update challenge_room_data.video_uploads set retry_at=now()-interval '1 minute' where id=$1", [cancelledJob.id]);
    const retry = (await claimWithNewTicket()).jobs;
    assert.equal(retry.length,1);
    assert.equal(retry[0].path,cancelledJob.path);
    assert.notEqual(retry[0].lease,cancelledJob.lease);
    assert.deepEqual(await sweep("finish",{...cancelledJob, success:true}), {ok:false});
    assert.deepEqual(await sweep("finish",{...retry[0], success:true}), {ok:true});
    assert.equal((await media(admin, "admin-preview", target)).path,good.path);
    console.log("PASS pending/cancelled/replaced upload expiry, current source protection, single-use cleanup ticket, failed lease and delayed retry");

    // 같은 기수 번호의 서로 다른 상품은 미션·업로드·구독을 공유하면 안 된다.
    await root();
    await db.exec(fs.readFileSync(migration("20261128090000_challenge_room_four_challenges.sql"),"utf8"));
    const courses=["voice","spinning","expression","answer"];
    const enrollments=courses.map(challenge=>({challenge,round:41}));
    const allCourses=uuid(), mixedCourses=uuid();
    for (const memberId of [allCourses,mixedCourses]) {
      await q("insert into public.members values($1,now(),'member')",[memberId]);
    }
    const mixed=[{challenge:"voice",round:40},{challenge:"spinning",round:41}];
    for (const [id,selected] of [[allCourses,enrollments],[mixedCourses,mixed]]) {
      await q("insert into public.applications(member_id,paid,payment_status,refunded,challenges) values($1,true,'paid',false,$2::jsonb)",[id,JSON.stringify(selected)]);
    }
    const sources=new Map(), missions=new Map();
    for (const course of [...enrollments,{challenge:"culture",round:41}]) {
      await root();
      await q("insert into public.challenge_rounds values($1,$2,$3,null)",[uuid(),course.challenge,course.round]);
      await edgeRole();
      const meta={...file,...course,name:course.challenge+".mp4"};
      if (course.challenge==="culture") {
        await assert.rejects(()=>media(admin,"admin-upload",meta));
        await role(admin);
        await assert.rejects(()=>rpc("admin-list",course));
        continue;
      }
      const original=await media(admin,"admin-upload",meta);
      sources.set(course.challenge,original.path);
      await root();
      await writeObject(original);
      await edgeRole();
      await media(admin,"admin-commit",{upload_id:original.upload_id});
      await role(admin);
      const mission=await rpc("admin-save",{...spec,...course,day_no:1,release_date:dates.future,title:course.challenge,chapter_start_seconds:0,chapter_end_seconds:12});
      missions.set(course.challenge,mission.id);
      const scheduled=await rpc("admin-list",course);
      assert.deepEqual(scheduled.missions.map(item=>item.id),[mission.id]);
      assert.equal(scheduled.week_videos[0].file_name,meta.name);
    }
    assert.equal(new Set(sources.values()).size,4);
    await role(admin);
    const removeDay=await rpc("admin-save",{...spec,challenge:"spinning",round:41,day_no:2,release_date:dates.future2});
    await assert.rejects(()=>rpc("admin-delete",{id:removeDay.id}),/not_found/);
    await assert.rejects(()=>rpc("admin-delete",{id:removeDay.id,challenge:"voice",round:41}),/not_found/);
    await rpc("admin-delete",{id:removeDay.id,challenge:"spinning",round:41});
    await role(mixedCourses);
    assert.deepEqual((await rpc("home")).cohorts.map(row=>row.challenge),["spinning"]);
    await edgeRole();
    await assert.rejects(()=>media(allCourses,"play",{id:missions.get("spinning")}));
    await root();
    await q("update challenge_room_data.missions set release_date=$1::date where id=any($2::uuid[])",[dates.past,[...missions.values()]]);
    await role(allCourses);
    const allHome=(await rpc("home")).cohorts;
    assert.deepEqual(allHome.map(row=>row.challenge).sort(),[...courses].sort());
    for (const row of allHome) {
      assert.equal(row.round,41);
      assert.deepEqual(row.missions.map(item=>item.id),[missions.get(row.challenge)]);
      const detail=(await rpc("mission",{id:row.missions[0].id})).mission;
      assert.equal(detail.challenge,row.challenge);
      assert.equal(detail.chapter.provider,"storage");
      await rpc("submit",{id:detail.id,body:row.challenge,request_id:uuid()});
    }
    const entries=(await rpc("history")).history;
    assert.deepEqual(entries.map(row=>row.challenge).sort(),[...courses].sort());
    assert(entries.every(row=>row.round===41 && missions.get(row.challenge)===row.mission_id));
    const pushScope={...reg,...enrollments[1],endpoint:reg.endpoint+"/scope"};
    assert((await rpc("push-enable",pushScope)).enabled);
    assert.equal((await rpc("push-status",{...pushScope,challenge:"voice"})).enabled,false);
    assert((await rpc("push-status",pushScope)).enabled);
    await role(mixedCourses);
    for (const course of courses.filter(name=>name!=="spinning")) {
      await assert.rejects(()=>rpc("mission",{id:missions.get(course)}),/not_found/);
      await assert.rejects(()=>rpc("push-enable",{...pushScope,challenge:course}));
    }
    await edgeRole();
    for (const course of courses) {
      assert.equal((await media(allCourses,"play",{id:missions.get(course)})).path,sources.get(course));
      if (course!=="spinning") await assert.rejects(()=>media(mixedCourses,"play",{id:missions.get(course)}));
    }
    assert.equal((await media(admin,"admin-preview",target)).path,good.path);
    // 과거에 운영자가 직접 넣은, 서비스 범위 밖인 종목의 답변도 개인 보관함에서 제외된다.
    await root();
    const hiddenMission=uuid(), hiddenAudio=allCourses+"/"+hiddenMission+"/"+uuid()+".webm";
    await q("insert into challenge_room_data.missions(id,round_id,day_no,release_date,title,body) select $1,id,1,$2,'문화 연습','연습' from public.challenge_rounds where challenge='culture' and round=41",[hiddenMission,dates.past]);
    await q("insert into challenge_room_data.answers(mission_id,member_id,request_id,audio_path) values($1,$2,$3,$4)",[hiddenMission,allCourses,uuid(),hiddenAudio]);
    await q("insert into storage.objects(bucket_id,name) values('challenge-room-audio',$1)",[hiddenAudio]);
    await role(allCourses);
    assert.equal((await rpc("history")).history.length,4);
    await assert.rejects(()=>rpc("mission",{id:hiddenMission}),/not_found/);
    assert.deepEqual(await q("select name from storage.objects where name=$1",[hiddenAudio]),[]);
    console.log("PASS 네 챌린지 같은 41기·주차 원본 격리, 미션/개인 이력/구독, 잘못 조합한 상품·기수 접근 거부, 기존 보신각 원본");

    console.log(
      "PASS combined production migration; guest/private ACL, admin create/locked/delete, KST future, scoped rounds, excluded refunded/failed, free/manual/partial, private/shared/text/audio submits, storage RLS, feedback + idempotency, own archive after refund, per-device opt-in and owner transfer",
    );
    console.log(
      "PASS weekly video migration, admin schedule validation, future visibility, chapter playback data, week locking and private archive",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.code || "", e.where || "");
  process.exit(1);
});
