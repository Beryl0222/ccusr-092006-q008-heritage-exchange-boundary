// 讲解员问答边界：面对临时提问，也只能在获准范围内回答。
//
// 讲解员不持有“能不能讲”的自由裁量。系统根据该场次的已获准节目、
// 讲解员角色被授予的切面、现场情境（地域/年龄/是否录制/是否商业拍摄）
// 实时判定：允许作答（给出可用要点）、拦截（给出安全话术）或转呈
// 传承人/共同体。任何问答都留痕。

import { SENSITIVITY } from "./heritage_exchange_boundary.js";

// 关键词 → 可能触及的切面/敏感类别。真实部署应由共同体提供词表。
const DEFAULT_CUE_RULES = Object.freeze([
  { cue: ["仪式", "祭祀", "祭仪", "祭", "ritual", "sacred"], aspect: "RITUAL_MEANING" },
  { cue: ["内传", "口诀", "秘传", "口传", "只传", "initiation"], aspect: "INTERNAL_ORAL" },
  { cue: ["复刻", "量产", "图案授权", "商用", "买图案", "license", "merchandise"], aspect: "COMMERCIAL_PATTERN" },
  { cue: ["神圣母题", "神纹", "totem"], aspect: "SACRED_MOTIF" },
]);

const SENSITIVE_ASPECTS = new Set(["RITUAL_MEANING", "INTERNAL_ORAL", "SACRED_MOTIF"]);

export class DocentGuard {
  constructor(store, { cueRules = DEFAULT_CUE_RULES, safeAnswer = null } = {}) {
    this.store = store;
    this.cueRules = cueRules;
    this.safeAnswer =
      safeAnswer ??
      "这部分属于共同体的内部口传或祭仪含义，不在本次跨境展演的公开范围。" +
        "我可以介绍可以公开分享的部分；若您需要更深入的了解，我会把问题记录并转呈传承人与来源共同体。";
  }

  detectAspects(question) {
    const q = String(question ?? "").toLowerCase();
    const hits = new Set();
    for (const rule of this.cueRules) {
      if (rule.cue.some((word) => q.includes(word.toLowerCase()))) hits.add(rule.aspect);
    }
    return [...hits];
  }

  // programDecision: evaluateProgram 的结果（该场次已获准的范围）
  // session: { city, territory_code, audience_age_min, recording, commercial, docent_id }
  // grants: 讲解员角色层面被允许讲述的切面映射 unit_id -> aspects[]
  evaluate({ question, unit_ref, programDecision, session, roleAspects }) {
    const triggered = this.detectAspects(question);
    const version = unit_ref ? this.store.getUnitVersion(unit_ref.unit_id, unit_ref.version) : null;

    // 找到该单元在本场节目中的评估项。
    const item = programDecision?.items?.find(
      (it) => it.ref.unit_id === unit_ref?.unit_id && String(it.ref.version) === String(unit_ref?.version),
    );

    const blocks = [];

    // 情境硬约束：节目评估已按本场 ctx（录制/年龄/商业）完成，
    // 若该项未获准，则任何提问都不可作答。
    if (!item) {
      blocks.push({ reason: "NOT_IN_PROGRAM", detail: "该内容不在本场次已获准的节目范围内" });
    } else if (!item.allowed) {
      blocks.push({ reason: "PROGRAM_NOT_LICENSED", detail: "节目层面该项在当前城市/情境下未获全部许可" });
    }

    // 角色切面授权：讲解员只能讲述被分派的切面。
    const allowedByRole = new Set(roleAspects?.[unit_ref?.unit_id] ?? []);
    const askedSensitive = triggered.filter((t) => SENSITIVE_ASPECTS.has(t));
    for (const asp of askedSensitive) {
      if (!allowedByRole.has(asp)) {
        blocks.push({ reason: "ASPECT_NOT_ASSIGNED", aspect: asp, detail: `讲解员角色未获授权讲述切面 ${asp}` });
      } else {
        const decision = item?.decisions?.find((d) => d.aspect === asp);
        if (!decision?.allowed) {
          blocks.push({ reason: "ASPECT_NOT_LICENSED_HERE", aspect: asp, detail: `切面 ${asp} 在当前场次情境（地域/年龄/录制/商业）下未获准` });
        }
      }
    }

    // 神圣母题：即便角色被分派，也不允许在录制/商业拍摄场景讲述。
    if (triggered.includes("SACRED_MOTIF") && (session?.recording || session?.commercial)) {
      blocks.push({ reason: "SACRED_ON_RECORD", detail: "神圣母题不得在录制或商业拍摄场景中讲述" });
    }

    // 密级兜底：RESTRICTED/SACRED 版本整体不可对未授权者展开。
    if (version && version.sensitivity !== "PUBLIC" && askedSensitive.length === 0 && !allowedByRole.has("*")) {
      // 不直接拦截公开切面，但若问题命中了受限版本却无任何角色切面，转呈。
      const hasAny = [...allowedByRole].some((a) => (version.aspects ?? []).includes(a));
      if (!hasAny && allowedByRole.size > 0) {
        blocks.push({ reason: "SENSITIVE_VERSION", detail: `该版本密级为 ${SENSITIVITY.indexOf(version.sensitivity) >= 0 ? version.sensitivity : "非公开"}，讲解员无可讲述切面` });
      }
    }

    // 即便没有触发敏感词，也必须有“本角色被分派 × 本场获准”的切面才可作答，
    // 防止讲解员被临时提问带进未授权内容。
    const speakable = item
      ? [...allowedByRole].filter((a) => item.decisions?.some((d) => d.aspect === a && d.allowed))
      : [];
    if (item && askedSensitive.length === 0 && speakable.length === 0) {
      blocks.push({ reason: "NO_SPEAKABLE_ASPECT", detail: "讲解员在当前场次没有任何获准可讲的切面" });
    }

    const allow = blocks.length === 0;
    return {
      allow,
      question: String(question ?? ""),
      unit_ref: unit_ref ?? null,
      triggered_aspects: triggered,
      blocks,
      // 允许时返回“可讲要点”：仅包含本角色获准且本场获准的切面名，不返回原文。
      speakable_aspects: allow ? speakable : [],
      response: allow
        ? { kind: "ANSWER_WITHIN_BOUNDARY", guidance: "仅限下列获准切面作答，不得即兴扩展到祭仪含义或内部口传。" }
        : { kind: "SAFE_DEFLECTION", text: this.safeAnswer, refer_to_custodian: true },
    };
  }
}
