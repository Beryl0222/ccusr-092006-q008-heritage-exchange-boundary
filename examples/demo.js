// 跨境展演知识边界服务演示：从登记到撤回留痕的完整流程。
// 运行：node examples/demo.js
import { readFile } from "node:fs/promises";
import { KnowledgeBoundaryService } from "../src/service.js";

let clock = Date.parse("2026-10-01T09:00:00+08:00");
const service = new KnowledgeBoundaryService({ now: () => new Date(clock).toISOString() });
const advanceDays = (days) => {
  clock += days * 24 * 3600 * 1000;
};

// 1. 登记并确认知识单元（面塑、茶艺故事、纹样视频、茶艺英译稿）。
const sample = JSON.parse(await readFile(new URL("../data/tour_units.sample.json", import.meta.url), "utf8"));
for (const draft of sample.units) {
  service.registerKnowledgeUnit(draft);
  service.confirmUnit(draft.unit_id, { confirmer: draft.community });
}
console.log("① 已登记并确认知识单元:", [...service.units.keys()].join(", "));

// 2. 节目获准：联合许可取交集（地域只剩 EU、不允许录制、不允许商业用途）。
const program = service.approveProgram({
  program_id: "PG-2026-AUTUMN",
  unit_ids: ["KU-MIANSU-001", "KU-CHAYI-001", "KU-WENYANG-001", "KU-CHAYI-001-EN"],
  context: { region: "EU", audience_age: 12, recording: false, commercial: false },
});
console.log("② 节目联合许可:", JSON.stringify(program.joint_license, null, 2));

// 3. 向海外学校签发离线材料包（可验证版本 + 自动失效）。
const pkg = service.issuePackage({
  package_id: "PK-PARIS-001",
  unit_ids: program.unit_ids,
  context: program.context,
  ttl_days: 30,
});
console.log(`③ 材料包已签发: hash=${pkg.package_hash.slice(0, 12)}… 自动失效于 ${pkg.expires_at}`);
console.log("   下载校验:", service.verifyPackage("PK-PARIS-001"));
service.downloadPackage("PK-PARIS-001", { by: "海外合作学校（虚构）" });

// 4. 巴黎场次使用确认，并演示讲解员临场问答边界。
service.acknowledgeUse({
  program_id: "PG-2026-AUTUMN",
  city: "巴黎",
  event_name: "2026 秋季巡演·巴黎站",
  medium: "现场讲解+讲义",
  audience_age: 12,
});
const allowed = service.answerQuestion({
  program_id: "PG-2026-AUTUMN",
  docent: "讲解员甲",
  question: "面塑的公开手法有哪些？",
  unit_ids: ["KU-MIANSU-001"],
});
const refused = service.answerQuestion({
  program_id: "PG-2026-AUTUMN",
  docent: "讲解员甲",
  question: "可以把面塑手法录下来做成付费课程吗？",
  unit_ids: ["KU-MIANSU-001"],
  context: { recording: true, commercial: true },
});
console.log("④ 临场问答（范围内）:", allowed);
console.log("   临场问答（超范围）:", refused);

// 5. 纹样共同体撤回许可：巴黎场次已完成不受影响，后续下载与复用停止。
advanceDays(5);
service.withdrawPermission("KU-WENYANG-001", { reason: "图样授权范围需重新协商" });
service.raiseDispute({ unit_id: "KU-WENYANG-001", raised_by: "民族纹样共同体（虚构）", detail: "学校下载包中混入了未公开图样" });
service.proposeSubstitute({ disputed_unit_id: "KU-WENYANG-001", substitute_unit_id: "KU-CHAYI-001", note: "以茶艺影像暂代纹样视频" });
try {
  service.downloadPackage("PK-PARIS-001", { by: "另一所学校" });
} catch (error) {
  console.log("⑤ 撤回后下载被拒绝:", error.message);
}

// 6. 传承人溯源视图：某段知识在哪座城市、哪次活动、哪种媒介出现过。
const report = service.unitReport("KU-WENYANG-001");
console.log("⑥ 纹样单元出现记录:", JSON.stringify(report.appearances, null, 2));
console.log("   争议与替代留痕:", report.disputes.length, "条争议 /", report.substitutes.length, "条替代");

// 7. 账本完整性。
console.log("⑦ 账本校验:", service.verifyLedger().length === 0 ? "通过" : "存在问题");
