import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { Ledger } from "../src/ledger.js";
import { BoundaryService } from "../src/service.js";
import { sha256Hex } from "../src/crypto.js";

const COMM = { community_id: "C1", name: "测试共同体", region: "CN-XX" };
const KEEPER = { custodian_id: "P1", name: "甲传承人", role: "守护者" };

async function newService(now = "2026-10-01T00:00:00Z") {
  const dir = mkdtempSync(join(tmpdir(), "hexb-svc-"));
  let clock = new Date(now);
  const ledger = await new Ledger(join(dir, "ledger.jsonl"), () => clock).load();
  const svc = await BoundaryService.create({ ledger, clock: () => clock });
  const setClock = (iso) => {
    clock = new Date(iso);
  };
  return { svc, setClock, dir };
}

async function registerBase(svc, { aspects = ["PUBLIC_TECHNIQUE", "INTERNAL_ORAL"], sensitivity = "RESTRICTED" } = {}) {
  await svc.registerUnit({
    unit_id: "u1", kind: "TECHNIQUE", title: "测试技艺", sensitivity, aspects,
    source_community: COMM, custodian: KEEPER, body_hash: await sha256Hex("body"),
  });
}

// ---------- 许可矩阵：同一张许可须覆盖全部维度 ----------

test("许可：任一维度不满足即拒绝，并返回具体违规维度", async () => {
  const { svc } = await newService();
  await registerBase(svc);
  await svc.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US"], min_age: 12,
    media: ["LIVE", "PRINT"], recording: "PROHIBITED", commercial: false,
    aspects: ["PUBLIC_TECHNIQUE"], attribution: "署名©C1", expires_at: "2027-01-01T00:00:00Z",
    confirmer: { ...KEEPER, community_id: "C1" },
  });
  const ref = [{ unit_id: "u1", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }];

  assert.equal(svc.evaluate(ref, { territory: "US", audience_age_min: 12, media: "LIVE" }).allowed, true);

  const geo = svc.evaluate(ref, { territory: "FR", media: "LIVE" });
  assert.equal(geo.allowed, false);
  assert.match(JSON.stringify(geo), /地域 FR/);

  const age = svc.evaluate(ref, { territory: "US", audience_age_min: 8, media: "LIVE" });
  assert.equal(age.allowed, false);
  assert.match(JSON.stringify(age), /年龄/);

  const mediaDenied = svc.evaluate(ref, { territory: "US", audience_age_min: 12, media: "DOWNLOAD" });
  assert.equal(mediaDenied.allowed, false);
  assert.match(JSON.stringify(mediaDenied), /媒介 DOWNLOAD/);

  const rec = svc.evaluate(ref, { territory: "US", audience_age_min: 12, media: "LIVE", recording: true });
  assert.equal(rec.allowed, false);
  assert.match(JSON.stringify(rec), /录制/);

  // 到期：用未来时钟重建服务，许可已过 expires_at
  const { svc: svcFuture } = await newService("2028-01-01T00:00:00Z");
  await registerBase(svcFuture);
  await svcFuture.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US"], min_age: 12,
    media: ["LIVE"], recording: "PROHIBITED", commercial: false,
    aspects: ["PUBLIC_TECHNIQUE"], attribution: "署名©C1", expires_at: "2027-01-01T00:00:00Z",
    confirmer: { ...KEEPER, community_id: "C1" },
  });
  const exp = svcFuture.evaluate(ref, { territory: "US", audience_age_min: 12, media: "LIVE" });
  assert.equal(exp.allowed, false);
  assert.match(JSON.stringify(exp), /到期/);
});

test("许可：不能用多张许可拼凑维度（商业与地域必须同一张覆盖）", async () => {
  const { svc } = await newService();
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE"], sensitivity: "PUBLIC" });
  // g-a：允许美国但禁止商业；g-b：允许商业但仅限新加坡。
  await svc.grantPermission({
    grant_id: "g-a", unit_id: "u1", territories: ["US"], media: ["DOWNLOAD"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.grantPermission({
    grant_id: "g-b", unit_id: "u1", territories: ["SG"], media: ["DOWNLOAD"],
    recording: "ALLOWED", commercial: true, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "b", confirmer: { ...KEEPER, community_id: "C1" },
  });
  const ref = [{ unit_id: "u1", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }];
  assert.equal(svc.evaluate(ref, { territory: "US", media: "DOWNLOAD", commercial: false }).allowed, true);
  // 美国+商业：两张许可都无法单独同时满足 → 拒绝
  const mixed = svc.evaluate(ref, { territory: "US", media: "DOWNLOAD", commercial: true });
  assert.equal(mixed.allowed, false);
});

test("登记校验：缺少来源共同体/密级/切面会被拒绝", async () => {
  const { svc } = await newService();
  await assert.rejects(() => svc.registerUnit({ unit_id: "x", kind: "TECHNIQUE", title: "t" }), /source_community/);
  await assert.rejects(
    () => svc.registerUnit({ unit_id: "x", kind: "TECHNIQUE", title: "t", source_community: COMM, sensitivity: "PUBLIC" }),
    /aspects/,
  );
});

// ---------- 节目交集 ----------

test("节目：引用任一项失败则整体失败，并返回逐项结论", async () => {
  const { svc } = await newService();
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE"], sensitivity: "PUBLIC" });
  await svc.registerUnit({
    unit_id: "u2", kind: "STORY", title: "祭仪故事", sensitivity: "SACRED",
    aspects: ["RITUAL_MEANING"], source_community: COMM, custodian: KEEPER,
  });
  await svc.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US"], media: ["LIVE"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.composeProgram({
    program_id: "P1", refs: [
      { unit_id: "u1", version: "1.0" },
      { unit_id: "u2", version: "1.0" },
    ],
  });
  const d = svc.evaluate("P1", { territory: "US", media: "LIVE" });
  assert.equal(d.allowed, false);
  assert.equal(d.items[0].allowed, true);
  assert.equal(d.items[1].allowed, false);
  assert.equal(d.rule.includes("ALL_ITEMS"), true);
});

// ---------- 派生链 ----------

test("派生：未复核不得继承；改变含义切断原确认", async () => {
  const { svc } = await newService();
  await svc.registerUnit({
    unit_id: "p", kind: "TECHNIQUE", title: "母本", sensitivity: "PUBLIC",
    aspects: ["PUBLIC_TECHNIQUE"], source_community: COMM, custodian: KEEPER,
  });
  await svc.grantPermission({
    grant_id: "gp", unit_id: "p", territories: ["US"], media: ["DOWNLOAD", "LIVE"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", allow_derivations: true, confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.registerUnit({
    unit_id: "c", kind: "TRANSLATION", title: "译本", sensitivity: "PUBLIC",
    aspects: ["PUBLIC_TECHNIQUE"], source_community: COMM, custodian: KEEPER,
  });
  await svc.recordDerivation({
    derivation_id: "d1", kind: "TRANSLATION",
    child: { unit_id: "c", version: "1.0" }, parent: { unit_id: "p", version: "1.0" },
  });
  const ref = [{ unit_id: "c", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }];
  assert.equal(svc.evaluate(ref, { territory: "US", media: "DOWNLOAD" }).allowed, false);

  await svc.reviewDerivation({ derivation_id: "d1", verdict: "MEANING_CHANGED", note: "改变含义" });
  const changed = svc.evaluate(ref, { territory: "US", media: "DOWNLOAD" });
  assert.equal(changed.allowed, false);
  assert.equal(changed.items[0].authority_intact, false);
  assert.match(changed.items[0].blocking_edge.reason, /改变了原义/);
});

// ---------- 撤回与祖父条款 ----------

test("撤回：保护此前已完成场次，停止此后复用", async () => {
  const { svc, setClock } = await newService("2026-09-01T00:00:00Z");
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE"], sensitivity: "PUBLIC" });
  await svc.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US"], media: ["LIVE", "DOWNLOAD"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.composeProgram({ program_id: "P1", refs: [{ unit_id: "u1", version: "1.0" }] });
  setClock("2026-09-10T00:00:00Z");
  await svc.completeShow({
    show_id: "s-before", program_id: "P1", event_name: "旧场", city: "Oldville", territory_code: "US",
  });
  setClock("2026-09-20T00:00:00Z");
  const w = await svc.withdrawPermission({ grant_id: "g1", reason: "争议" });
  assert.deepEqual(w.preserved_shows.map((s) => s.show_id), ["s-before"]);

  await assert.rejects(
    () => svc.completeShow({ show_id: "s-after", program_id: "P1", event_name: "新场", city: "Newville", territory_code: "US" }),
    /不满足全部许可/,
  );
  const rl = await svc.revocationList();
  assert.equal(rl.doc.grants[0].grant_id, "g1");
});

test("撤回晚于场次时间的场次不受祖父条款保护", async () => {
  const { svc, setClock } = await newService("2026-09-01T00:00:00Z");
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE"], sensitivity: "PUBLIC" });
  await svc.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US"], media: ["LIVE"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", confirmer: { ...KEEPER, community_id: "C1" },
  });
  setClock("2026-09-20T00:00:00Z");
  const w = await svc.withdrawPermission({ grant_id: "g1" });
  assert.deepEqual(w.preserved_shows, []);
});

// ---------- 材料包 ----------

test("材料包：未全部获准禁止签发；已签发包可离线验证，撤销后失效", async () => {
  const { svc } = await newService();
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE"], sensitivity: "PUBLIC" });
  await svc.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US"], media: ["DOWNLOAD"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "署名©C1", expires_at: "2027-01-01T00:00:00Z",
    confirmer: { ...KEEPER, community_id: "C1" },
  });
  const recipient = { school: "S", city: "Town", country: "US", territory_code: "US" };
  const issued = await svc.issuePackage({
    package_id: "pkg1", program_id: undefined,
    refs: [{ unit_id: "u1", version: "1.0" }],
    files: { "u1@1.0": Buffer.from("讲义字节") }, recipient,
  });
  const files = {};
  for (const p of Object.keys(issued.bundle.manifest.contents)) files[p] = Buffer.from("讲义字节");
  const bundle = { manifest: issued.bundle.manifest, signature: issued.bundle.signature, files };

  const ok = await svc.verifyOffline(bundle, { ctx: { territory: "US", media: "DOWNLOAD" } });
  assert.equal(ok.valid, true);

  // 场景复核：法国下载被条款拒绝
  const geo = await svc.verifyOffline(bundle, { ctx: { territory: "FR", media: "DOWNLOAD" } });
  assert.equal(geo.valid, false);

  await svc.withdrawPermission({ grant_id: "g1", reason: "撤回" });
  const rl = await svc.revocationList();
  const revoked = await svc.verifyOffline(bundle, { revocation: rl, ctx: { territory: "US", media: "DOWNLOAD" } });
  assert.equal(revoked.valid, false);
  assert.equal(revoked.status, "REVOKED");
});

// ---------- 讲解员 ----------

test("讲解员：越界提问被拦截并留痕；边界内允许", async () => {
  const { svc } = await newService();
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE", "INTERNAL_ORAL"], sensitivity: "RESTRICTED" });
  await svc.grantPermission({
    grant_id: "g-pub", unit_id: "u1", territories: ["US"], media: ["LIVE_QA", "LIVE"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.grantPermission({
    grant_id: "g-oral", unit_id: "u1", territories: ["CN"], media: ["LIVE"],
    recording: "PROHIBITED", commercial: false, aspects: ["INTERNAL_ORAL"],
    attribution: "内部", confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.composeProgram({ program_id: "P1", refs: [{ unit_id: "u1", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }] });
  const session = { docent_id: "D1", city: "Town", territory_code: "US", audience_age_min: 12 };
  const role = { u1: ["PUBLIC_TECHNIQUE"] };

  const allow = await svc.docentAnswer({
    program_id: "P1", session, unit_ref: { unit_id: "u1", version: "1.0" },
    question: "公开手法怎么做？", role_aspects: role,
  });
  assert.equal(allow.allow, true);
  assert.deepEqual(allow.speakable_aspects, ["PUBLIC_TECHNIQUE"]);

  const block = await svc.docentAnswer({
    program_id: "P1", session, unit_ref: { unit_id: "u1", version: "1.0" },
    question: "内部口诀和祭祀含义是什么？", role_aspects: role,
  });
  assert.equal(block.allow, false);
  assert.equal(block.response.kind, "SAFE_DEFLECTION");
  assert.ok(block.triggered_aspects.includes("INTERNAL_ORAL"));
});

// ---------- 溯源 ----------

test("溯源：按城市/活动/媒介聚合出现记录", async () => {
  const { svc } = await newService();
  await registerBase(svc, { aspects: ["PUBLIC_TECHNIQUE"], sensitivity: "PUBLIC" });
  await svc.grantPermission({
    grant_id: "g1", unit_id: "u1", territories: ["US", "FR"], media: ["LIVE", "DOWNLOAD"],
    recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
    attribution: "a", confirmer: { ...KEEPER, community_id: "C1" },
  });
  await svc.composeProgram({ program_id: "P1", refs: [{ unit_id: "u1", version: "1.0" }] });
  await svc.completeShow({ show_id: "s1", program_id: "P1", event_name: "巴黎之夜", city: "Paris", territory_code: "FR" });
  await svc.completeShow({ show_id: "s2", program_id: "P1", event_name: "纽约之夜", city: "New York", territory_code: "US" });

  const view = svc.appearancesOf("u1");
  assert.equal(view.total, 2);
  const cities = view.by_city_event.map((g) => g.city).sort();
  assert.deepEqual(cities, ["New York", "Paris"]);
  assert.ok(view.timeline.every((r) => r.media === "LIVE"));
});
