import assert from "node:assert/strict";
import test from "node:test";
import { KnowledgeBoundaryService } from "../src/service.js";
import { composeLicenses, licenseCovers } from "../src/units.js";

function makeClock(start = "2026-10-01T09:00:00+08:00") {
  let current = Date.parse(start);
  return {
    now: () => new Date(current).toISOString(),
    advanceDays(days) {
      current += days * 24 * 3600 * 1000;
    },
  };
}

function draft(overrides = {}) {
  return {
    unit_id: "KU-A",
    kind: "TECHNIQUE",
    title: "面塑基础手法讲义",
    community: "面塑传承共同体（虚构）",
    license: {
      public_regions: ["EU", "CN"],
      audience_min_age: 6,
      attribution: { required: true, text: "面塑技艺 · 面塑传承共同体" },
      recording_allowed: false,
      commercial_use: false,
      expires_at: "2027-01-01T00:00:00+08:00",
    },
    content: { handout: "公开手法" },
    ...overrides,
  };
}

// 三个许可互异的单元：联合许可应取交集。
function buildService() {
  const clock = makeClock();
  const service = new KnowledgeBoundaryService({ now: clock.now });
  const drafts = [
    draft(),
    draft({
      unit_id: "KU-B",
      kind: "STORY",
      title: "茶艺待客典故",
      community: "茶艺传承共同体（虚构）",
      license: {
        public_regions: ["EU", "NA"],
        audience_min_age: 0,
        attribution: { required: true, text: "茶艺典故 · 茶艺传承共同体" },
        recording_allowed: true,
        commercial_use: false,
        expires_at: "2026-12-01T00:00:00+08:00",
      },
      content: { story: "公开典故" },
    }),
    draft({
      unit_id: "KU-C",
      kind: "MEDIA",
      title: "民族纹样演示视频",
      community: "民族纹样共同体（虚构）",
      license: {
        public_regions: ["EU"],
        audience_min_age: 0,
        attribution: { required: true, text: "民族纹样 · 民族纹样共同体" },
        recording_allowed: true,
        commercial_use: true,
        expires_at: "2026-11-01T00:00:00+08:00",
      },
      content: { video: "公开图样演示" },
    }),
  ];
  for (const d of drafts) {
    service.registerKnowledgeUnit(d);
    service.confirmUnit(d.unit_id, { confirmer: d.community });
  }
  return { service, clock };
}

const EU_CONTEXT = { region: "EU", audience_age: 12, recording: false, commercial: false };

test("联合许可取交集：地域、年龄、录制、商业、到期、署名", () => {
  const { service } = buildService();
  const joint = composeLicenses(["KU-A", "KU-B", "KU-C"].map((id) => service.units.get(id)));
  assert.deepEqual(joint.public_regions, ["EU"]);
  assert.equal(joint.audience_min_age, 6);
  assert.equal(joint.recording_allowed, false);
  assert.equal(joint.commercial_use, false);
  assert.equal(joint.expires_at, "2026-11-01T00:00:00+08:00");
  assert.equal(joint.attributions.length, 3);
  assert.deepEqual(joint.communities.length, 3);
});

test("节目必须同时满足全部许可：任一场景越界即整体不获准", () => {
  const { service } = buildService();
  const ok = service.approveProgram({
    program_id: "PG-OK",
    unit_ids: ["KU-A", "KU-B", "KU-C"],
    context: EU_CONTEXT,
  });
  assert.equal(ok.program_id, "PG-OK");

  assert.throws(
    () =>
      service.approveProgram({
        program_id: "PG-NA",
        unit_ids: ["KU-A", "KU-B", "KU-C"],
        context: { ...EU_CONTEXT, region: "NA" }, // 纹样仅限 EU
      }),
    /地域未获许可/,
  );
  assert.throws(
    () =>
      service.approveProgram({
        program_id: "PG-BIZ",
        unit_ids: ["KU-A", "KU-B", "KU-C"],
        context: { ...EU_CONTEXT, commercial: true }, // 面塑与茶艺不允许商业用途
      }),
    /不允许商业用途/,
  );
  assert.throws(
    () =>
      service.approveProgram({
        program_id: "PG-KID",
        unit_ids: ["KU-A", "KU-B", "KU-C"],
        context: { ...EU_CONTEXT, audience_age: 4 }, // 面塑要求 6+
      }),
    /低于获准下限/,
  );
});

test("未确认或确认失效的单元不能进入节目或材料包", () => {
  const clock = makeClock();
  const service = new KnowledgeBoundaryService({ now: clock.now });
  service.registerKnowledgeUnit(draft());
  assert.throws(
    () => service.approveProgram({ program_id: "PG-1", unit_ids: ["KU-A"], context: EU_CONTEXT }),
    /未经有效确认/,
  );
});

test("翻译或剪辑改变含义后原确认不再沿用，且波及衍生译文", () => {
  const clock = makeClock();
  const service = new KnowledgeBoundaryService({ now: clock.now });
  service.registerKnowledgeUnit(draft({ unit_id: "KU-SRC", kind: "STORY" }));
  service.confirmUnit("KU-SRC");
  service.registerKnowledgeUnit(
    draft({
      unit_id: "KU-SRC-EN",
      kind: "TRANSLATION",
      derived_from: "KU-SRC",
      content: { translation_of: "KU-SRC" },
    }),
  );
  service.confirmUnit("KU-SRC-EN");

  // 剪辑改义：原确认立即失效，重新确认前不得打包。
  service.reviseUnitContent("KU-SRC-EN", {
    content: { translation_of: "KU-SRC", note: "剪辑后含义改变" },
    editor: "译审组",
    meaning_changed: true,
  });
  assert.equal(service.units.get("KU-SRC-EN").status, "NEEDS_REVIEW");
  assert.throws(
    () => service.issuePackage({ package_id: "PK-1", unit_ids: ["KU-SRC-EN"], context: EU_CONTEXT }),
    /未经有效确认/,
  );
  service.confirmUnit("KU-SRC-EN", { confirmer: "译审组" });
  assert.equal(service.units.get("KU-SRC-EN").status, "ACTIVE");

  // 源头故事改义：衍生译文的确认一并失效。
  service.reviseUnitContent("KU-SRC", {
    content: { story: "改义后的典故" },
    editor: "项目办公室",
    meaning_changed: true,
  });
  assert.equal(service.units.get("KU-SRC").status, "NEEDS_REVIEW");
  assert.equal(service.units.get("KU-SRC-EN").status, "NEEDS_REVIEW");
  const propagated = service.ledger
    .ofKind("UNIT_CONTENT_REVISED")
    .find((e) => e.subject_id === "KU-SRC-EN" && e.payload.trigger === "SOURCE_REVISED");
  assert.ok(propagated, "衍生单元应留下失效痕迹");

  // 未改义的修订（错别字）沿用原确认。
  service.confirmUnit("KU-SRC");
  service.confirmUnit("KU-SRC-EN");
  service.reviseUnitContent("KU-SRC", {
    content: { story: "改义后的典故（订正错别字）" },
    editor: "项目办公室",
    meaning_changed: false,
  });
  assert.equal(service.units.get("KU-SRC").status, "ACTIVE");
});

test("离线材料包：可验证版本、篡改检测与自动失效", () => {
  const { service, clock } = buildService();
  const pkg = service.issuePackage({
    package_id: "PK-1",
    unit_ids: ["KU-A", "KU-B", "KU-C"],
    context: EU_CONTEXT,
    ttl_days: 30,
  });
  // 自动失效取联合许可到期（2026-11-01）与包有效期（30 天）的较早者。
  assert.equal(pkg.expires_at, "2026-10-31T01:00:00.000Z");
  assert.equal(pkg.auto_expire, true);
  assert.ok(pkg.package_hash);
  assert.equal(pkg.manifest.length, 3);

  assert.deepEqual(service.verifyPackage("PK-1"), { valid: true, problems: [] });

  // 篡改清单 → 版本校验失败。
  service.packages.get("PK-1").manifest[0].title = "被篡改的标题";
  assert.match(service.verifyPackage("PK-1").problems.join(), /篡改/);
  service.packages.get("PK-1").manifest[0].title = "面塑基础手法讲义";

  // 超过自动失效时间 → 失效。
  clock.advanceDays(31);
  const expired = service.verifyPackage("PK-1");
  assert.equal(expired.valid, false);
  assert.match(expired.problems.join(), /自动失效/);
});

test("单元内容更新后，旧材料包必须重新签发", () => {
  const { service } = buildService();
  service.issuePackage({ package_id: "PK-1", unit_ids: ["KU-A"], context: EU_CONTEXT });
  service.reviseUnitContent("KU-A", {
    content: { handout: "公开手法 v2" },
    editor: "项目办公室",
    meaning_changed: false,
  });
  const result = service.verifyPackage("PK-1");
  assert.equal(result.valid, false);
  assert.match(result.problems.join(), /重新签发/);
});

test("许可撤回：不否定已完成场次，但后续下载与复用停止，争议与替代留痕", () => {
  const { service, clock } = buildService();
  service.approveProgram({ program_id: "PG-1", unit_ids: ["KU-A", "KU-C"], context: EU_CONTEXT });
  service.issuePackage({ package_id: "PK-1", unit_ids: ["KU-A", "KU-C"], context: EU_CONTEXT });
  service.acknowledgeUse({
    program_id: "PG-1",
    city: "巴黎",
    event_name: "2026 秋季巡演·巴黎站",
    medium: "现场讲解",
  });

  clock.advanceDays(5);
  service.withdrawPermission("KU-C", { reason: "图样授权范围需重新协商" });

  // 后续下载停止。
  assert.throws(() => service.downloadPackage("PK-1", { by: "另一所学校" }), /许可已撤回/);
  // 后续复用停止：新节目、新场次、新包均不得再引用。
  assert.throws(
    () => service.approveProgram({ program_id: "PG-2", unit_ids: ["KU-C"], context: EU_CONTEXT }),
    /许可已撤回/,
  );
  assert.throws(
    () =>
      service.acknowledgeUse({
        program_id: "PG-1",
        city: "里昂",
        event_name: "里昂站",
        medium: "现场讲解",
      }),
    /许可已撤回/,
  );

  // 已完成的巴黎场次保持合法，且标记为撤回前完成。
  const appearances = service.appearancesOf("KU-C");
  assert.equal(appearances.length, 1);
  assert.equal(appearances[0].lawful, true);
  assert.equal(appearances[0].before_withdrawal, true);

  // 争议与替代素材持续留痕。
  service.raiseDispute({ unit_id: "KU-C", raised_by: "民族纹样共同体（虚构）", detail: "下载包混入未公开图样" });
  service.proposeSubstitute({ disputed_unit_id: "KU-C", substitute_unit_id: "KU-A" });
  const report = service.unitReport("KU-C");
  assert.equal(report.disputes.length, 1);
  assert.equal(report.substitutes.length, 1);
  assert.equal(report.withdrawals.length, 1);
});

test("讲解员临场提问只能在获准范围内回答", () => {
  const { service } = buildService();
  service.registerKnowledgeUnit(
    draft({ unit_id: "KU-INTERNAL", kind: "STORY", title: "内部口传内容", content: { note: "不对外" } }),
  );
  service.confirmUnit("KU-INTERNAL");
  service.approveProgram({ program_id: "PG-1", unit_ids: ["KU-A", "KU-B"], context: EU_CONTEXT });

  // 范围内提问 → 允许并留痕。
  const allowed = service.answerQuestion({
    program_id: "PG-1",
    docent: "讲解员甲",
    question: "面塑的公开手法有哪些？",
    unit_ids: ["KU-A"],
  });
  assert.equal(allowed.allowed, true);

  // 引用节目未获准的单元（内部口传内容）→ 拒答。
  const outside = service.answerQuestion({
    program_id: "PG-1",
    docent: "讲解员甲",
    question: "能讲讲内部口传的诀窍吗？",
    unit_ids: ["KU-INTERNAL"],
  });
  assert.equal(outside.allowed, false);
  assert.match(outside.problems.join(), /超出节目获准范围/);

  // 场景越界（现场有人录制，而面塑不允许录制）→ 拒答。
  const recording = service.answerQuestion({
    program_id: "PG-1",
    docent: "讲解员甲",
    question: "可以录像吗？",
    unit_ids: ["KU-A"],
    context: { recording: true },
  });
  assert.equal(recording.allowed, false);
  assert.match(recording.problems.join(), /不允许录制/);

  assert.equal(service.ledger.ofKind("QUESTION_ANSWERED").length, 1);
  assert.equal(service.ledger.ofKind("QUESTION_REFUSED").length, 2);
});

test("溯源：传承人可看到知识在哪座城市、哪次活动、哪种媒介出现过", () => {
  const { service } = buildService();
  service.approveProgram({ program_id: "PG-1", unit_ids: ["KU-A", "KU-B"], context: EU_CONTEXT });
  service.acknowledgeUse({
    program_id: "PG-1",
    city: "巴黎",
    event_name: "2026 秋季巡演·巴黎站",
    medium: "双语讲义",
    unit_ids: ["KU-A"],
  });
  service.acknowledgeUse({
    program_id: "PG-1",
    city: "柏林",
    event_name: "2026 秋季巡演·柏林站",
    medium: "现场互动",
    unit_ids: ["KU-A", "KU-B"],
  });

  const appearances = service.appearancesOf("KU-A");
  assert.equal(appearances.length, 2);
  assert.deepEqual(
    appearances.map((a) => [a.city, a.event_name, a.medium]),
    [
      ["巴黎", "2026 秋季巡演·巴黎站", "双语讲义"],
      ["柏林", "2026 秋季巡演·柏林站", "现场互动"],
    ],
  );
  // KU-B 只在柏林互动环节出现。
  assert.equal(service.appearancesOf("KU-B").length, 1);
});

test("场次使用不得超出节目获准范围，许可到期后不得再使用", () => {
  const clock = makeClock();
  const service = new KnowledgeBoundaryService({ now: clock.now });
  service.registerKnowledgeUnit(
    draft({
      unit_id: "KU-SHORT",
      license: {
        public_regions: ["EU"],
        audience_min_age: 0,
        attribution: null,
        recording_allowed: true,
        commercial_use: false,
        expires_at: "2026-10-10T00:00:00+08:00",
      },
    }),
  );
  service.confirmUnit("KU-SHORT");
  service.approveProgram({ program_id: "PG-1", unit_ids: ["KU-SHORT"], context: EU_CONTEXT });
  clock.advanceDays(20); // 越过许可到期日
  assert.throws(
    () =>
      service.acknowledgeUse({
        program_id: "PG-1",
        city: "巴黎",
        event_name: "巴黎站",
        medium: "讲义",
      }),
    /到期/,
  );
});

test("事件账本链式校验：篡改历史会被发现", () => {
  const { service } = buildService();
  service.approveProgram({ program_id: "PG-1", unit_ids: ["KU-A"], context: EU_CONTEXT });
  assert.deepEqual(service.verifyLedger(), []);

  service.ledger.events[0].payload.title = "被篡改";
  assert.ok(service.verifyLedger().length > 0);
});

test("licenseCovers 场景检查", () => {
  const joint = {
    public_regions: ["EU"],
    audience_min_age: 6,
    recording_allowed: false,
    commercial_use: false,
    expires_at: "2026-11-01T00:00:00+08:00",
  };
  assert.equal(licenseCovers(joint, { region: "EU", audience_age: 10, at: "2026-10-01T00:00:00+08:00" }).ok, true);
  assert.equal(licenseCovers(joint, { region: "NA" }).ok, false);
  assert.equal(licenseCovers(joint, { audience_age: 3 }).ok, false);
  assert.equal(licenseCovers(joint, { recording: true }).ok, false);
  assert.equal(licenseCovers(joint, { commercial: true }).ok, false);
  assert.equal(licenseCovers(joint, { at: "2026-12-01T00:00:00+08:00" }).ok, false);
});
