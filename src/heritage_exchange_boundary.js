// heritage_exchange_boundary 领域资料的基础结构。

export const EVENT_KINDS = Object.freeze([
  "KNOWLEDGE_REGISTERED", // 知识单元登记（技艺/故事/影像/译文/互动）
  "UNIT_CONFIRMED", // 来源共同体或传承人确认当前版本
  "UNIT_CONTENT_REVISED", // 内容被翻译或剪辑修订，原确认不再沿用
  "TRANSLATION_REVIEWED", // 译文复核通过
  "PROGRAM_APPROVED", // 节目通过联合许可校验
  "PACKAGE_ISSUED", // 离线材料包签发（含可验证版本与自动失效信息）
  "PACKAGE_DOWNLOADED", // 离线材料包被下载
  "USE_ACKNOWLEDGED", // 场次使用确认（城市/活动/媒介留痕）
  "QUESTION_ANSWERED", // 讲解员临场作答（在获准范围内）
  "QUESTION_REFUSED", // 讲解员拒答（超出获准范围）
  "PERMISSION_WITHDRAWN", // 许可撤回（不否定已依法完成的场次）
  "DISPUTE_RAISED", // 争议登记
  "SUBSTITUTE_PROPOSED", // 替代素材提议
]);

export const REQUIRED_FIELDS = Object.freeze(["event_id", "kind", "occurred_at", "subject_id", "payload"]);

export function validateEvent(record) {
  const problems = REQUIRED_FIELDS.filter((name) => !(name in record));
  if (!EVENT_KINDS.includes(record.kind)) problems.push("kind");
  return problems;
}
