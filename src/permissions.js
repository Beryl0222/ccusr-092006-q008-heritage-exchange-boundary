// 许可评估（纯函数）：单个许可、单元版本（含派生继承）、节目交集。
//
// 核心规则：
// 1) 一次使用的全部维度（地域/年龄/媒介/录制/商业/有效期/切面）必须由
//    “同一张”许可同时覆盖，不能用多张许可拼凑；
// 2) 节目引用任意一项，就必须满足该项全部许可，逐项做逻辑与；
// 3) 翻译/剪辑只有在复核“保全原义（FAITHFUL）”且原许可允许派生时，
//    原确认才沿派生链继承；一旦判定改变含义，继承立即切断。

import { MEDIA } from "./heritage_exchange_boundary.js";

export function isWithinTerritory(grant, code) {
  return grant.territories.includes("*") || grant.territories.includes(code);
}

// 评估一张许可对“某次使用、某个知识切面”是否覆盖全部维度。
// ctx: { territory, audience_age_min, media, recording, commercial, at }
export function checkGrant(grant, aspect, ctx) {
  const violations = [];
  const now = ctx.at ? new Date(ctx.at) : new Date();

  if (grant.status !== "ACTIVE") violations.push({ dimension: "withdrawal", reason: "许可已撤回" });
  if (!(grant.aspects.includes("*") || grant.aspects.includes(aspect))) {
    violations.push({ dimension: "aspects", reason: `未覆盖切面 ${aspect}` });
  }
  if (ctx.territory && !isWithinTerritory(grant, ctx.territory)) {
    violations.push({ dimension: "territory", reason: `地域 ${ctx.territory} 不在 ${grant.territories.join("/")}` });
  }
  if (typeof ctx.audience_age_min === "number" && ctx.audience_age_min < (grant.min_age ?? 0)) {
    violations.push({ dimension: "age", reason: `受众最低年龄 ${ctx.audience_age_min} 低于许可下限 ${grant.min_age}` });
  }
  if (ctx.media && !grant.media.includes(ctx.media)) {
    violations.push({ dimension: "media", reason: `媒介 ${ctx.media} 不被允许（${grant.media.join("/")}）` });
  }
  // 仅当现场确实在录制时，才要求“允许录制”；未录制不触发该维度。
  if (ctx.recording === true && grant.recording !== "ALLOWED") {
    violations.push({ dimension: "recording", reason: "现场正在录制，而该许可禁止录制" });
  }
  if (ctx.commercial === true && grant.commercial !== true) {
    violations.push({ dimension: "commercial", reason: "商业用途不被允许" });
  }
  if (grant.valid_from && now < new Date(grant.valid_from)) {
    violations.push({ dimension: "validity", reason: "许可尚未生效" });
  }
  if (grant.expires_at && now > new Date(grant.expires_at)) {
    violations.push({ dimension: "validity", reason: `许可已于 ${grant.expires_at} 到期` });
  }
  return { ok: violations.length === 0, violations };
}

// 沿派生链解析“权威来源”。
// chain[0] 是被使用的版本，其后逐代为父本；遇到未复核或判定改变含义
// 的派生边即截断，截断点之外的许可不得继承。
export function resolveAuthority(ref, store) {
  const chain = [{ unit_id: ref.unit_id, version: ref.version }];
  const edges = [];
  let current = ref;
  for (let guard = 0; guard < 32; guard += 1) {
    const edge = store.findDerivationByChild(current.unit_id, current.version);
    if (!edge) break;
    edges.push(edge);
    if (edge.review_status !== "REVIEWED" || edge.verdict !== "FAITHFUL" || !edge.propagates) {
      return { chain, edges, intact: false, blocking_edge: edge };
    }
    current = { unit_id: edge.parent.unit_id, version: edge.parent.version };
    chain.push(current);
  }
  return { chain, edges, intact: true, blocking_edge: null };
}

// 评估某单元版本（含可继承的上游许可）对一次使用的结论。
// aspects 缺省取该版本登记的全部切面。
export function evaluateUnit(ref, ctx, store) {
  const version = store.getUnitVersion(ref.unit_id, ref.version);
  if (!version) return { ref, found: false, aspects: [], decisions: [], allowed: false };

  const aspects = ctx.aspects ?? version.aspects ?? ["*"];
  const authority = resolveAuthority(ref, store);

  // 候选许可：本版本自有许可 + 完整继承链上各祖先的许可（须许可派生）。
  const candidates = [];
  for (const node of authority.chain) {
    for (const grant of store.grantsFor(node.unit_id, node.version)) {
      const isAncestor = !(node.unit_id === ref.unit_id && node.version === ref.version);
      if (isAncestor && grant.allow_derivations !== true) continue;
      candidates.push(grant);
    }
  }

  const decisions = aspects.map((aspect) => {
    const passing = [];
    const failed = [];
    for (const grant of candidates) {
      const result = checkGrant(grant, aspect, ctx);
      if (result.ok) passing.push(grant);
      else failed.push({ grant_id: grant.grant_id, violations: result.violations });
    }
    if (candidates.length === 0) {
      failed.push({ grant_id: null, violations: [{ dimension: "grant", reason: "该切面在整条来源链上都没有许可" }] });
    }
    return {
      aspect,
      allowed: passing.length > 0,
      matched_grant: passing[0]?.grant_id ?? null,
      required_attribution: passing[0]?.attribution ?? null,
      failed,
    };
  });

  return {
    ref,
    found: true,
    title: version.title,
    sensitivity: version.sensitivity,
    authority_intact: authority.intact,
    blocking_edge: authority.blocking_edge
      ? {
          derivation_id: authority.blocking_edge.derivation_id,
          reason:
            authority.blocking_edge.review_status === "PENDING"
              ? "译制/剪辑尚未完成含义复核"
              : "复核认定改变了原义，原许可确认不再沿用",
        }
      : null,
    aspects,
    decisions,
    allowed: decisions.every((d) => d.allowed),
  };
}

// 节目交集：每个引用项的每个切面都必须通过，节目整体才算获准。
export function evaluateProgram(refs, ctx, store) {
  if (!refs.length) throw new Error("节目至少需要引用一个知识单元");
  if (ctx.media && !MEDIA.includes(ctx.media)) throw new Error(`未知媒介: ${ctx.media}`);

  const items = refs.map((ref) => evaluateUnit(ref, { ...ctx, aspects: ctx.aspects ?? ref.aspects ?? undefined }, store));
  const allowed = items.every((item) => item.allowed);
  const requiredAttribution = [
    ...new Set(
      items
        .flatMap((item) => item.decisions ?? [])
        .map((d) => d.required_attribution)
        .filter(Boolean),
    ),
  ];
  const expiries = items
    .flatMap((item) =>
      (item.decisions ?? [])
        .map((d) => store.getGrant(d.matched_grant))
        .filter(Boolean)
        .map((g) => g.expires_at)
        .filter(Boolean),
    )
    .sort();

  return {
    allowed,
    media: ctx.media,
    territory: ctx.territory ?? null,
    evaluated_at: ctx.at ?? new Date().toISOString(),
    items,
    required_attribution: requiredAttribution,
    earliest_expiry: expiries[0] ?? null,
    rule: "ALL_ITEMS_ALL_DIMENSIONS: 任一引用项的任一维度不满足，节目即不获准",
  };
}
