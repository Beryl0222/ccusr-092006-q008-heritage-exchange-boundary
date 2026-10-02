// 知识单元与联合许可规则。
//
// 项目办公室把技艺、故事、影像、译文、互动环节拆成可管理的知识单元，
// 每个单元注明来源共同体与许可边界；节目引用任意单元时，
// 必须同时满足全部许可（取交集），任一不满足即整体不获准。

export const UNIT_KINDS = Object.freeze([
  "TECHNIQUE", // 技艺（如面塑手法）
  "STORY", // 故事（如茶艺典故）
  "MEDIA", // 影像（如民族纹样演示视频）
  "TRANSLATION", // 译文（双语讲义译稿）
  "INTERACTION", // 互动环节
]);

export const UNIT_STATUS = Object.freeze([
  "PENDING_CONFIRMATION", // 已登记，待来源共同体确认
  "ACTIVE", // 已确认，可在许可范围内使用
  "NEEDS_REVIEW", // 翻译或剪辑改变含义，原确认失效，待复核
  "WITHDRAWN", // 许可已撤回，禁止新的下载与复用
]);

export const LICENSE_FIELDS = Object.freeze([
  "public_regions", // 可公开地域（地区代码列表）
  "audience_min_age", // 受众最小年龄
  "attribution", // 署名要求：null 或 { required, text }
  "recording_allowed", // 是否允许录制
  "commercial_use", // 是否允许商业用途
  "expires_at", // 许可到期日（ISO 时间，null 表示长期）
]);

export function validateLicense(license) {
  if (!license || typeof license !== "object") return ["license"];
  const problems = [];
  if (!Array.isArray(license.public_regions) || license.public_regions.length === 0) {
    problems.push("public_regions");
  }
  if (!Number.isInteger(license.audience_min_age) || license.audience_min_age < 0) {
    problems.push("audience_min_age");
  }
  const attribution = license.attribution;
  const attributionOk =
    attribution === null ||
    (typeof attribution === "object" &&
      typeof attribution.required === "boolean" &&
      typeof attribution.text === "string");
  if (!attributionOk) problems.push("attribution");
  if (typeof license.recording_allowed !== "boolean") problems.push("recording_allowed");
  if (typeof license.commercial_use !== "boolean") problems.push("commercial_use");
  if (license.expires_at !== null && Number.isNaN(Date.parse(license.expires_at))) {
    problems.push("expires_at");
  }
  return problems;
}

// 联合许可：节目引用多个单元时，许可取交集——
// 地域取共同部分、年龄取最高下限、录制与商业用途取逻辑与、到期日取最早、署名全部保留。
export function composeLicenses(units) {
  if (units.length === 0) throw new Error("联合许可至少需要一个知识单元");
  const commonRegions = units
    .map((unit) => unit.license.public_regions)
    .reduce((acc, regions) => acc.filter((region) => regions.includes(region)));
  const expiries = units
    .map((unit) => unit.license.expires_at)
    .filter(Boolean)
    .sort();
  return {
    unit_ids: units.map((unit) => unit.unit_id),
    communities: [...new Set(units.map((unit) => unit.community))],
    public_regions: [...new Set(commonRegions)],
    audience_min_age: Math.max(...units.map((unit) => unit.license.audience_min_age)),
    recording_allowed: units.every((unit) => unit.license.recording_allowed),
    commercial_use: units.every((unit) => unit.license.commercial_use),
    expires_at: expiries.length > 0 ? expiries[0] : null,
    attributions: [
      ...new Set(
        units
          .filter((unit) => unit.license.attribution && unit.license.attribution.required)
          .map((unit) => unit.license.attribution.text),
      ),
    ],
  };
}

// 检查联合许可是否覆盖某个使用场景。
// context: { region, audience_age, recording, commercial, at }
export function licenseCovers(joint, context = {}) {
  const problems = [];
  if (context.region !== undefined && !joint.public_regions.includes(context.region)) {
    problems.push(`地域未获许可: ${context.region}`);
  }
  if (context.audience_age !== undefined && context.audience_age < joint.audience_min_age) {
    problems.push(`受众年龄 ${context.audience_age} 低于获准下限 ${joint.audience_min_age}`);
  }
  if (context.recording === true && !joint.recording_allowed) {
    problems.push("联合许可不允许录制");
  }
  if (context.commercial === true && !joint.commercial_use) {
    problems.push("联合许可不允许商业用途");
  }
  if (context.at && joint.expires_at && Date.parse(context.at) > Date.parse(joint.expires_at)) {
    problems.push(`许可已于 ${joint.expires_at} 到期`);
  }
  return { ok: problems.length === 0, problems };
}
