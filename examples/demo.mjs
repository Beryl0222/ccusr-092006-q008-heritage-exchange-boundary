// 端到端剧本：面塑 / 茶艺 / 民族纹样三个来源共同体的跨境展演。
//
// 运行：node examples/demo.mjs
// 剧本自带断言：若边界规则被破坏会直接抛错。全部资料为虚构。

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { Ledger } from "../src/ledger.js";
import { BoundaryService } from "../src/service.js";
import { sha256Hex } from "../src/crypto.js";

const dir = mkdtempSync(join(tmpdir(), "hexb-"));
let clock = new Date("2026-09-15T09:00:00Z");
const ledger = await new Ledger(join(dir, "ledger.jsonl"), () => clock).load();
const svc = await BoundaryService.create({ ledger, issuerId: "office-PO", clock: () => clock });

const line = (t) => console.log(`\n=== ${t} ===`);
const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
const denied = async (fn, fragment) => {
  try {
    await fn();
    throw new Error("本应被拒绝，却成功了");
  } catch (e) {
    const haystack = `${e.code ?? ""} ${e.message} ${JSON.stringify(e.decision ?? {})}`;
    ok(e.code === "LICENSE_DENIED" && haystack.includes(fragment), `已拦截：${e.message}（命中 “${fragment}”）`);
    return e.decision;
  }
};

// 三个来源共同体与传承人（虚构）。
const MT = { community_id: "C-MT", name: "晋南面塑共同体", region: "CN-SX" };
const CY = { community_id: "C-CY", name: "闽南茶艺共同体", region: "CN-FJ" };
const MW = { community_id: "C-MW", name: "西南山地纹样共同体", region: "CN-YN" };
const wang = { custodian_id: "P-wang", name: "王师傅", role: "面塑传承人" };
const lin = { custodian_id: "P-lin", name: "林老师", role: "茶艺传承人" };
const long = { custodian_id: "P-long", name: "龙女士", role: "纹样守护者" };

line("1. 登记知识单元：技艺 / 故事 / 影像 / 译文 / 互动，逐项标注切面与密级");
await svc.registerUnit({
  unit_id: "mt-tech", kind: "TECHNIQUE", title: "面塑捏制技艺", sensitivity: "RESTRICTED",
  aspects: ["PUBLIC_TECHNIQUE", "INTERNAL_ORAL"], source_community: MT, custodian: wang,
  body_hash: await sha256Hex("面塑公开手法+内部口诀（虚构正本）"),
});
await svc.registerUnit({
  unit_id: "mt-story", kind: "STORY", title: "面塑祭祖口传", sensitivity: "SACRED",
  aspects: ["PUBLIC_STORY", "RITUAL_MEANING"], source_community: MT, custodian: wang,
  body_hash: await sha256Hex("公开故事与祭仪含义（虚构正本）"),
});
await svc.registerUnit({
  unit_id: "cy-tech", kind: "TECHNIQUE", title: "茶艺冲泡手法", sensitivity: "PUBLIC",
  aspects: ["PUBLIC_TECHNIQUE"], source_community: CY, custodian: lin,
  body_hash: await sha256Hex("茶艺手法（虚构正本）"),
});
await svc.registerUnit({
  unit_id: "mw-pattern", kind: "IMAGE", title: "民族纹样图集", sensitivity: "RESTRICTED",
  aspects: ["COMMERCIAL_PATTERN", "SACRED_MOTIF", "IMAGE_STILL"], source_community: MW, custodian: long,
  body_hash: await sha256Hex("可复刻图样与神圣母题（虚构正本）"),
});
await svc.registerUnit({
  unit_id: "mt-interact", kind: "INTERACTION", title: "面塑动手体验", sensitivity: "PUBLIC",
  aspects: ["INTERACTION_TRY"], source_community: MT, custodian: wang,
  body_hash: await sha256Hex("互动环节脚本（虚构）"),
});
console.log("  已登记 5 个知识单元，内部口传/祭仪/可商用图样与公开内容分属不同切面");

line("2. 来源共同体分别确认许可（地域/年龄/媒介/录制/商业/署名/到期日）");
await svc.grantPermission({
  grant_id: "g-mt-tech-pub", unit_id: "mt-tech", version: "1.0",
  territories: ["US", "SG"], min_age: 6, media: ["LIVE", "LIVE_QA", "VIDEO", "PRINT", "DOWNLOAD"],
  recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
  attribution: "面塑捏制技艺 © 晋南面塑共同体·王师傅", expires_at: "2027-06-30T23:59:59Z",
  confirmer: { ...wang, community_id: "C-MT" }, scope_note: "仅限公开手法，不含内部口诀",
});
await svc.grantPermission({
  grant_id: "g-mt-oral-cn", unit_id: "mt-tech", version: "1.0",
  territories: ["CN"], min_age: 16, media: ["LIVE"], recording: "PROHIBITED", commercial: false,
  aspects: ["INTERNAL_ORAL"], attribution: "内部传承，不署名公开",
  confirmer: { ...wang, community_id: "C-MT" },
});
await svc.grantPermission({
  grant_id: "g-mt-story-pub", unit_id: "mt-story", version: "1.0",
  territories: ["US", "SG", "CN"], min_age: 6, media: ["LIVE", "LIVE_QA", "PRINT", "DOWNLOAD"],
  recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_STORY"],
  attribution: "面塑民俗故事 © 晋南面塑共同体·王师傅",
  confirmer: { ...wang, community_id: "C-MT" },
});
await svc.grantPermission({
  grant_id: "g-cy-pub", unit_id: "cy-tech", version: "1.0",
  territories: ["*"], min_age: 0, media: ["LIVE", "LIVE_QA", "VIDEO", "PRINT", "DOWNLOAD"],
  recording: "ALLOWED", commercial: false, aspects: ["PUBLIC_TECHNIQUE"],
  attribution: "茶艺冲泡手法 © 闽南茶艺共同体·林老师", allow_derivations: true,
  expires_at: "2028-01-01T00:00:00Z", confirmer: { ...lin, community_id: "C-CY" },
});
await svc.grantPermission({
  grant_id: "g-mw-commercial-sg", unit_id: "mw-pattern", version: "1.0",
  territories: ["SG"], min_age: 0, media: ["PRINT", "DOWNLOAD"], recording: "PROHIBITED",
  commercial: true, aspects: ["COMMERCIAL_PATTERN"],
  attribution: "民族纹样商用授权 © 西南山地纹样共同体", expires_at: "2026-12-31T23:59:59Z",
  confirmer: { ...long, community_id: "C-MW" }, scope_note: "仅新加坡校园文创，图样编号 MW-A01~A12",
});
await svc.grantPermission({
  grant_id: "g-mw-sacred-cn", unit_id: "mw-pattern", version: "1.0",
  territories: ["CN"], min_age: 18, media: ["LIVE"], recording: "PROHIBITED", commercial: false,
  aspects: ["SACRED_MOTIF"], attribution: "神圣母题，仅限仪式现场",
  confirmer: { ...long, community_id: "C-MW" },
});
await svc.grantPermission({
  grant_id: "g-mt-interact", unit_id: "mt-interact", version: "1.0",
  territories: ["US", "SG"], min_age: 6, media: ["LIVE"], recording: "ALLOWED", commercial: false,
  aspects: ["INTERACTION_TRY"], attribution: "面塑体验 © 晋南面塑共同体",
  confirmer: { ...wang, community_id: "C-MT" },
});
console.log("  祭仪含义没有任何海外许可；可商业复刻图样仅在新加坡、且到期 2026-12-31");

line("3. 海外学校巡演前索要双语讲义+演示视频：试图把内部口传/祭仪/商用图样打进同一下载包");
await svc.composeProgram({
  program_id: "P-us-request", name: "旧金山学校请求的原始大包",
  refs: [
    { unit_id: "mt-tech", version: "1.0", aspects: ["PUBLIC_TECHNIQUE", "INTERNAL_ORAL"] },
    { unit_id: "mt-story", version: "1.0", aspects: ["PUBLIC_STORY", "RITUAL_MEANING"] },
    { unit_id: "mw-pattern", version: "1.0", aspects: ["COMMERCIAL_PATTERN", "SACRED_MOTIF"] },
  ],
});
const bad = svc.evaluate("P-us-request", { territory: "US", audience_age_min: 10, media: "DOWNLOAD" });
ok(!bad.allowed, "整包被拒绝：节目引用须同时满足全部许可");
ok(JSON.stringify(bad).includes("RITUAL_MEANING"), "祭仪切面无许可 → 显式列出");
ok(JSON.stringify(bad).includes("INTERNAL_ORAL"), "内部口传仅限 CN 现场 → 美国下载被拒");
ok(JSON.stringify(bad).includes("地域 US 不在"), "商用图样仅 SG 授权 → 地域拦截");
await denied(
  () => svc.issuePackage({
    package_id: "pkg-leak", package_version: "1.0", name: "事故大包",
    program_id: "P-us-request", recipient: { school: "SF School", city: "San Francisco", country: "US", territory_code: "US" },
  }),
  "LICENSE",
);

line("4. 收敛到获准范围后，节目与离线包才能签发（逐项许可、署名、最早到期日）");
// 下载节目只含媒介含 DOWNLOAD 的公开单元；互动环节仅限现场，另立现场节目。
await svc.composeProgram({
  program_id: "P-us-tour", name: "2026 北美校园巡展·可下载公开单元",
  refs: [
    { unit_id: "mt-tech", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] },
    { unit_id: "mt-story", version: "1.0", aspects: ["PUBLIC_STORY"] },
    { unit_id: "cy-tech", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] },
  ],
});
await svc.composeProgram({
  program_id: "P-us-live", name: "2026 北美校园巡展·现场节目（含互动）",
  refs: [
    { unit_id: "mt-tech", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] },
    { unit_id: "mt-story", version: "1.0", aspects: ["PUBLIC_STORY"] },
    { unit_id: "cy-tech", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] },
    { unit_id: "mt-interact", version: "1.0", aspects: ["INTERACTION_TRY"] },
  ],
});
const good = svc.evaluate("P-us-tour", { territory: "US", audience_age_min: 10, media: "DOWNLOAD" });
ok(good.allowed, "公开单元在美下载评估通过");
ok(good.required_attribution.length === 3, `必须附带全部署名（${good.required_attribution.length} 条）`);

// 实际随包字节（讲义/视频），用与清单相同的逻辑路径构造。
const rawFiles = {
  "mt-tech@1.0": Buffer.from("面塑公开手法·中英双语讲义（虚构）"),
  "mt-story@1.0": Buffer.from("面塑民俗故事·中英双语讲义（虚构）"),
  "cy-tech@1.0": Buffer.from("茶艺公开手法演示视频（虚构字节）"),
};
const issued = await svc.issuePackage({
  package_id: "pkg-us-2026", package_version: "1.0", name: "北美校园巡演材料包",
  program_id: "P-us-tour", event_name: "旧金山学校展演日", files: rawFiles,
  audience_age_min: 10,
  recipient: { school: "SF School", city: "San Francisco", country: "US", territory_code: "US" },
});
ok(/^[0-9a-f]{64}$/.test(issued.manifest_version_hash), "清单带可验证版本号（SHA-256）");
ok(issued.expires_at === "2027-06-30T23:59:59Z", `包级自动失效取最早到期：${issued.expires_at}`);
console.log(`  清单版本哈希: ${issued.manifest_version_hash.slice(0, 16)}…`);

line("5. 离线核验：签名 + 逐项哈希；篡改与到期自动失效");
const bundle = { manifest: issued.bundle.manifest, signature: issued.bundle.signature };
// 逻辑路径 -> 随包字节，供离线侧按清单逐项核对。
const files = {};
for (const path of Object.keys(bundle.manifest.contents)) {
  const key = path.split("/")[1]; // contents/<unit>@<version>/...
  files[path] = rawFiles[key];
}
const v = await svc.verifyOffline({ ...bundle, files }, { ctx: { at: "2026-10-01T00:00:00Z" } });
ok(v.valid, `离线包有效（${v.checks.length} 项检查全部通过）`);

const tampered = {
  ...bundle,
  files: { ...files, [Object.keys(files)[0]]: Buffer.from("被替换的双语讲义") },
};
const vt = await svc.verifyOffline(tampered, { ctx: { at: "2026-10-01T00:00:00Z" } });
ok(!vt.valid && vt.status === "DENIED", "替换任一讲义/视频 → 内容哈希不符，整包失效");

const badSig = { manifest: { ...bundle.manifest, name: "改个名" }, files, signature: bundle.signature };
const vs = await svc.verifyOffline(badSig, { ctx: { at: "2026-10-01T00:00:00Z" } });
ok(!vs.valid && vs.status === "UNTRUSTED", "改动清单 → 签名核验失败，整包不可信");

const ve = await svc.verifyOffline({ ...bundle, files }, { ctx: { at: "2027-09-01T00:00:00Z" } });
ok(!ve.valid && ve.status === "EXPIRED", "超过 2027-06-30 → 自动失效，无需联网");

line("6. 翻译/剪辑派生：保全原义才继承确认；改变含义后原许可不再沿用");
await svc.registerUnit({
  unit_id: "cy-tech-en", kind: "TRANSLATION", title: "English Translation of Tea Technique",
  sensitivity: "PUBLIC", aspects: ["PUBLIC_TECHNIQUE"], source_community: CY, custodian: lin,
  body_hash: await sha256Hex("faithful english text"),
});
await svc.recordDerivation({
  derivation_id: "d-en-1", kind: "TRANSLATION",
  child: { unit_id: "cy-tech-en", version: "1.0" }, parent: { unit_id: "cy-tech", version: "1.0" },
  language: "en", created_by: { person_id: "tr-1", name: "校译者 A" },
});
const pending = svc.evaluate([{ unit_id: "cy-tech-en", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }], {
  territory: "US", media: "DOWNLOAD",
});
ok(!pending.allowed && JSON.stringify(pending).includes("尚未完成含义复核"), "未复核译文不得使用");
await svc.reviewDerivation({ derivation_id: "d-en-1", verdict: "FAITHFUL", note: "术语经林老师确认，保全原义", reviewer: lin });
const afterFaithful = svc.evaluate([{ unit_id: "cy-tech-en", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }], {
  territory: "US", media: "DOWNLOAD",
});
ok(afterFaithful.allowed, "复核保全原义 → 原共同体许可沿译链继承");

await svc.registerUnit({
  unit_id: "cy-tech-en-clip", kind: "TRANSLATION", title: "Tea Clip (Re-edited)",
  sensitivity: "PUBLIC", aspects: ["PUBLIC_TECHNIQUE"], source_community: CY, custodian: lin,
  body_hash: await sha256Hex("changed meaning clip"),
});
await svc.recordDerivation({
  derivation_id: "d-en-2", kind: "EDIT",
  child: { unit_id: "cy-tech-en-clip", version: "1.0" }, parent: { unit_id: "cy-tech-en", version: "1.0" },
  edit_note: "学校剪辑时把‘敬长’次序调换并加了商品口播", created_by: { person_id: "school", name: "SF School" },
});
await svc.reviewDerivation({ derivation_id: "d-en-2", verdict: "MEANING_CHANGED", note: "礼序含义被改变且夹带商业内容", reviewer: lin });
const changed = svc.evaluate([{ unit_id: "cy-tech-en-clip", version: "1.0", aspects: ["PUBLIC_TECHNIQUE"] }], {
  territory: "US", media: "DOWNLOAD",
});
ok(!changed.allowed && JSON.stringify(changed).includes("改变了原义"), "改变含义的剪辑 → 原确认不再沿用，下游断链");

line("7. 现场场次：许可有效时依法完成并锚定时间（撤回的祖父条款依据）");
clock = new Date("2026-10-05T18:00:00Z");
const show = await svc.completeShow({
  show_id: "show-sf-1005", program_id: "P-us-live", event_name: "旧金山学校展演日",
  city: "San Francisco", territory_code: "US", audience_age_min: 10, recording: false,
});
ok(show.recorded, "10 月 5 日旧金山场次记为依法完成");

line("8. 讲解员临时提问：只能在获准范围内作答，越界自动安全话术并留痕");
const role = {
  "mt-tech": ["PUBLIC_TECHNIQUE"],
  "mt-story": ["PUBLIC_STORY"],
  "cy-tech": ["PUBLIC_TECHNIQUE"],
  "mt-interact": ["INTERACTION_TRY"],
};
const a1 = await svc.docentAnswer({
  program_id: "P-us-live", show_id: "show-sf-1005",
  session: { docent_id: "D-01", city: "San Francisco", territory_code: "US", audience_age_min: 10 },
  unit_ref: { unit_id: "mt-tech", version: "1.0" }, question: "可以讲讲面团怎么配色吗？", role_aspects: role,
});
ok(a1.allow && a1.speakable_aspects.includes("PUBLIC_TECHNIQUE"), "公开手法提问 → 在边界内作答");

const a2 = await svc.docentAnswer({
  program_id: "P-us-live", show_id: "show-sf-1005",
  session: { docent_id: "D-01", city: "San Francisco", territory_code: "US", audience_age_min: 10 },
  unit_ref: { unit_id: "mt-story", version: "1.0" }, question: "这个面塑在祭祀里具体是什么祭仪含义？", role_aspects: role,
});
ok(!a2.allow && a2.response.kind === "SAFE_DEFLECTION", "祭仪含义提问 → 拦截并给出安全话术，转呈传承人");

const a3 = await svc.docentAnswer({
  program_id: "P-us-live", show_id: "show-sf-1005",
  session: { docent_id: "D-01", city: "San Francisco", territory_code: "US", audience_age_min: 10, recording: true },
  unit_ref: { unit_id: "mt-tech", version: "1.0" }, question: "顺便问下内部口诀？", role_aspects: role,
});
ok(!a3.allow, "内部口诀 + 录制现场 → 拦截（角色未授权且切面无许可）");

line("9. 许可撤回：不否定已完成场次，但后续下载与复用立即停止");
clock = new Date("2026-10-20T09:00:00Z");
const withdrawal = await svc.withdrawPermission({ grant_id: "g-mt-tech-pub", reason: "王师傅发现海外视频被二次商用，撤回公开手法许可" });
ok(withdrawal.preserved_shows.some((s) => s.show_id === "show-sf-1005"), "已完成的 10/5 旧金山场次受祖父条款保护，不被否定");

const rl = await svc.revocationList();
ok(rl.doc.grants.some((g) => g.grant_id === "g-mt-tech-pub"), "撤销名单含被撤回许可（可随包/联网下发）");
const vRevoked = await svc.verifyOffline({ ...bundle, files }, { revocation: rl, ctx: { at: "2026-10-21T00:00:00Z" } });
ok(!vRevoked.valid && vRevoked.status === "REVOKED", "已下载的离线包命中撤销名单 → 后续复用必须停止");
await denied(
  () => svc.completeShow({
    show_id: "show-sf-1021", program_id: "P-us-live", event_name: "西雅图学校展演日",
    city: "Seattle", territory_code: "US", audience_age_min: 10,
  }),
  "许可已撤回",
);

line("10. 争议与替代素材持续留痕");
const dispute = await svc.recordDispute({
  dispute_id: "dp-001", unit_ref: { unit_id: "mw-pattern", version: "1.0" },
  raised_by: { community_id: "C-MW", person: long }, reason: "发现旧金山讲义中出现与神圣母题近似的图样",
  severity: "HIGH", city: "San Francisco", event_name: "旧金山学校展演日",
});
await svc.registerUnit({
  unit_id: "mw-alt", kind: "IMAGE", title: "共同体批准的替代几何纹", sensitivity: "PUBLIC",
  aspects: ["IMAGE_STILL", "COMMERCIAL_PATTERN"], source_community: MW, custodian: long,
  body_hash: await sha256Hex("approved substitute"),
});
await svc.grantPermission({
  grant_id: "g-mw-alt-us", unit_id: "mw-alt", version: "1.0",
  territories: ["US"], min_age: 0, media: ["PRINT", "DOWNLOAD", "LIVE"], recording: "ALLOWED",
  commercial: true, aspects: ["IMAGE_STILL", "COMMERCIAL_PATTERN"],
  attribution: "替代几何纹 © 西南山地纹样共同体", confirmer: { ...long, community_id: "C-MW" },
});
await svc.linkSubstitute({ dispute_id: "dp-001", substitute: { unit_id: "mw-alt", version: "1.0" }, note: "用于替换涉争议图样的下一版讲义" });
await svc.resolveDispute({ dispute_id: "dp-001", outcome: "UPHELD", note: "维持限制，全部改用替代素材" });
const d = svc.listDisputes()[0];
ok(d.status === "RESOLVED_RESTRICTED" && d.substitutes.length === 1, "争议结论与替代素材关联留痕");

line("11. 传承人打开记录：某段知识在哪座城市、哪次活动、哪种媒介出现过");
const view = svc.appearancesOf("mt-tech");
console.log(JSON.stringify(view.by_city_event, null, 2));
ok(view.total >= 3, `mt-tech 共出现 ${view.total} 次（下载/现场/问答）`);
ok(view.by_city_event.some((g) => g.city === "San Francisco" && g.media.includes("DOWNLOAD")), "可直接看到旧金山·下载包记录");
const lineage = svc.lineageOf("cy-tech");
ok(lineage.derivations.some((d) => d.verdict === "FAITHFUL"), "谱系中可查译文继承链与复核结论");

line("12. 账本自校验：全部动作哈希链可复验");
const chain = await svc.verifyLedger();
ok(chain.ok && chain.count === svc.status().ledger_events, `哈希链完整（${chain.count} 条事件，tip ${chain.tip.slice(0, 12)}…）`);
console.log("\n全部场景通过。知识边界服务运行正常。");
console.log(JSON.stringify(svc.status(), null, 2));
