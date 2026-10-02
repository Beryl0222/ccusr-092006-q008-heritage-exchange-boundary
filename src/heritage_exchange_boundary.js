// 非遗跨境展演知识边界：领域词表与最小事件校验。
//
// 所有模块共用同一套术语：知识单元的种类、密级、媒介、许可维度，
// 以及账本中允许出现的事件种类。真实个人信息、生产连接与外部账号
// 均不进入本资料。

// 知识单元类型：技艺、故事、影像、译文、互动环节。
export const UNIT_KINDS = Object.freeze([
  "TECHNIQUE", // 技艺（如面塑捏制步骤、茶艺手法）
  "STORY", // 故事/口传内容（含内部口传与祭仪含义）
  "IMAGE", // 影像/图样（含可商业复刻的民族纹样）
  "TRANSLATION", // 译文（对其他单元的派生）
  "INTERACTION", // 互动环节
]);

// 密级：公开内容、受限内容（内部口传等）、神圣内容（祭仪含义等）。
export const SENSITIVITY = Object.freeze(["PUBLIC", "RESTRICTED", "SACRED"]);

// 媒介：节目引用与离线复用发生在哪种媒介上。
export const MEDIA = Object.freeze([
  "LIVE", // 现场展演
  "LIVE_QA", // 现场问答
  "VIDEO", // 视频
  "AUDIO", // 音频
  "PRINT", // 纸质讲义
  "DOWNLOAD", // 下载包
]);

// 录制立场：场馆/观众是否允许录制。
export const RECORDING_POLICY = Object.freeze(["PROHIBITED", "ALLOWED"]);

// 标准知识切面：同一知识单元内部仍有不同密级的内容，必须按切面授权，
// 避免“内部口传、祭仪含义、可商业复刻图样”被打进同一个下载包。
// 允许共同体自定义扩展切面，但登记时建议沿用下列名称。
export const ASPECT_SUGGESTIONS = Object.freeze([
  "PUBLIC_TECHNIQUE", // 可公开演示的技艺步骤
  "INTERNAL_ORAL", // 共同体内传口传内容
  "RITUAL_MEANING", // 祭仪含义
  "SACRED_MOTIF", // 神圣母题（不可复刻）
  "COMMERCIAL_PATTERN", // 可商业复刻图样
  "PUBLIC_STORY", // 可公开讲述的故事
  "IMAGE_FULL", // 完整影像/原图
  "IMAGE_STILL", // 影像截帧/缩略图
  "INTERACTION_TRY", // 观众动手体验环节
]);

// 派生方式：翻译或剪辑。
export const DERIVATION_KINDS = Object.freeze(["TRANSLATION", "EDIT"]);

// 账本事件种类（保留早期资料中的五种命名，并补齐服务所需事件）。
export const EVENT_KINDS = Object.freeze([
  "KNOWLEDGE_REGISTERED", // 知识单元登记
  "KNOWLEDGE_UPDATED", // 单元升版
  "DERIVATION_RECORDED", // 翻译/剪辑派生登记
  "PERMISSION_GRANTED", // 来源共同体确认许可
  "TRANSLATION_REVIEWED", // 译文/剪辑复核（确认是否保全原义）
  "PERMISSION_WITHDRAWN", // 许可撤回
  "PROGRAM_COMPOSED", // 节目引用组合
  "PACKAGE_ISSUED", // 离线材料包签发
  "PACKAGE_REVOKED", // 离线材料包整包撤销
  "USE_ACKNOWLEDGED", // 使用留痕（下载/复用确认）
  "SHOW_COMPLETED", // 场次依法完成（撤回时的祖父条款锚点）
  "ANSWER_GIVEN", // 讲解员在获准范围内作答
  "ANSWER_GUARDED", // 讲解员越界提问被拦截/改用安全话术
  "DISPUTE_RECORDED", // 争议登记
  "SUBSTITUTE_LINKED", // 替代素材关联
  "DISPUTE_RESOLVED", // 争议了结
  "APPEARANCE_RECORDED", // 知识单元在城市/活动/媒介中出现
]);

export const REQUIRED_FIELDS = Object.freeze(["event_id", "kind", "occurred_at", "subject_id", "payload"]);

export function validateEvent(record) {
  const problems = REQUIRED_FIELDS.filter((name) => !(name in record));
  if (!EVENT_KINDS.includes(record.kind)) problems.push("kind");
  return problems;
}

// 许可维度的中文名，用于向传承人/共同体出具可读记录。
export const DIMENSION_LABELS = Object.freeze({
  territory: "可公开地域",
  age: "受众年龄",
  media: "媒介",
  recording: "录制",
  commercial: "商业用途",
  attribution: "署名",
  validity: "有效期",
  aspects: "知识切面",
  withdrawal: "撤回状态",
});
