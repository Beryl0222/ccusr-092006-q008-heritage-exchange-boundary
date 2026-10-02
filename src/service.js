// 跨境展演知识边界服务：把登记、许可、节目、离线包、问答、撤回、争议、
// 溯源串成一个以账本为唯一事实来源的门面。
//
// 所有写操作都追加账本事件并重放；许可撤回不删除旧事件——已经依法完成
// 的场次锚定在历史上，后续下载与复用则由撤销名单与到期机制停止。

import {
  DERIVATION_KINDS,
  MEDIA,
} from "./heritage_exchange_boundary.js";
import { evaluateProgram as evaluateProgramPure, resolveAuthority } from "./permissions.js";
import { Store, validateGrantInput, validateUnitInput } from "./store.js";
import { DocentGuard } from "./docent.js";
import {
  buildManifest,
  buildRevocationList,
  manifestVersionHash,
  signManifest,
  verifyPackage,
} from "./package.js";
import { generateSigningKeyPair } from "./crypto.js";

export class BoundaryService {
  constructor({ ledger, keySet, issuerId = "office-PO", clock = () => new Date(), docentOptions = {} }) {
    this.ledger = ledger;
    this.keySet = keySet;
    this.issuerId = issuerId;
    this.clock = clock;
    this.docentOptions = docentOptions;
    this.guard = new DocentGuard(null, docentOptions);
    this.reload();
  }

  static async create(deps) {
    const keySet = deps.keySet ?? (await generateSigningKeyPair());
    return new BoundaryService({ ...deps, keySet });
  }

  reload() {
    this.store = Store.replay(this.ledger.events());
    this.guard = new DocentGuard(this.store, this.docentOptions);
    return this;
  }

  now() {
    return this.clock();
  }

  async append(kind, subjectId, payload) {
    const record = await this.ledger.append(kind, subjectId, payload, { occurredAt: this.now() });
    this.reload();
    return record;
  }

  // ---------- 知识单元登记 ----------

  async registerUnit(input) {
    const problems = validateUnitInput(input);
    if (problems.length) throw new Error(`知识单元登记非法：${problems.join(",")}`);
    const version = input.version ?? "1.0";
    if (this.store.getUnitVersion(input.unit_id, version)) {
      throw new Error(`版本已存在: ${input.unit_id}@${version}`);
    }
    await this.append("KNOWLEDGE_REGISTERED", input.unit_id, {
      unit_id: input.unit_id,
      version,
      kind: input.kind,
      title: input.title,
      sensitivity: input.sensitivity,
      aspects: input.aspects,
      source_community: input.source_community, // {community_id, name, region}
      custodian: input.custodian ?? null, // {custodian_id, name, role}
      body_hash: input.body_hash ?? null, // 讲义/视频正本哈希（内容本身不进账本）
      content_uri: input.content_uri ?? null,
      notes: input.notes ?? "",
    });
    return this.store.getUnitVersion(input.unit_id, version);
  }

  async updateUnit(unitId, patch) {
    const unit = this.store.getUnit(unitId);
    if (!unit) throw new Error(`知识单元不存在: ${unitId}`);
    const nextVersion = patch.version ?? bumpVersion(unit.versions[unit.versions.length - 1]);
    await this.append("KNOWLEDGE_UPDATED", unitId, {
      unit_id: unitId,
      version: nextVersion,
      kind: patch.kind ?? unit.kind,
      title: patch.title ?? unit.title,
      sensitivity: patch.sensitivity ?? this.store.getUnitVersion(unitId, unit.versions.at(-1)).sensitivity,
      aspects: patch.aspects ?? this.store.getUnitVersion(unitId, unit.versions.at(-1)).aspects,
      source_community: patch.source_community ?? unit.source_community,
      custodian: patch.custodian ?? unit.custodian,
      body_hash: patch.body_hash ?? null,
      content_uri: patch.content_uri ?? null,
      notes: patch.notes ?? "",
      supersedes: unit.versions.at(-1),
    });
    return this.store.getUnitVersion(unitId, nextVersion);
  }

  getUnit(unitId) {
    return this.store.getUnit(unitId);
  }

  // ---------- 许可确认 ----------

  async grantPermission(input) {
    const problems = validateGrantInput(input);
    if (problems.length) throw new Error(`许可确认非法：${problems.join(",")}`);
    if (!this.store.getUnit(input.unit_id)) throw new Error(`知识单元不存在: ${input.unit_id}`);
    if (this.store.getGrant(input.grant_id)) throw new Error(`许可编号重复: ${input.grant_id}`);
    const version = input.version ?? this.store.getUnit(input.unit_id).versions.at(-1);
    if (!this.store.getUnitVersion(input.unit_id, version)) throw new Error(`版本不存在: ${input.unit_id}@${version}`);

    await this.append("PERMISSION_GRANTED", input.unit_id, {
      grant_id: input.grant_id,
      unit_id: input.unit_id,
      version: String(version),
      territories: input.territories, // ISO 3166-1 alpha-2/细分码，"*" 为不限
      min_age: input.min_age ?? 0,
      media: input.media,
      recording: input.recording,
      commercial: input.commercial,
      aspects: input.aspects,
      attribution: input.attribution, // 必须展示的署名
      allow_derivations: input.allow_derivations ?? false, // 是否允许翻译/剪辑派生
      valid_from: input.valid_from ?? this.now().toISOString(),
      expires_at: input.expires_at ?? null,
      confirmer: input.confirmer, // {person_id, name, role, community_id}
      confirmed_via: input.confirmed_via ?? "written",
      scope_note: input.scope_note ?? "",
    });
    return this.store.getGrant(input.grant_id);
  }

  // 许可撤回：不否定撤回时刻之前依法完成的场次；后续下载/复用一律停止。
  async withdrawPermission({ grant_id, reason = "" }) {
    const grant = this.store.getGrant(grant_id);
    if (!grant) throw new Error(`许可不存在: ${grant_id}`);
    if (grant.status === "WITHDRAWN") throw new Error(`许可已处于撤回状态: ${grant_id}`);
    const withdrawnAt = this.now().toISOString();

    // 撤回前已完成、且使用了该单元的场次，受祖父条款保护。
    const preservedShows = this.store.shows.filter(
      (s) => s.completed_at <= withdrawnAt && s.refs?.some((r) => r.unit_id === grant.unit_id),
    );

    await this.append("PERMISSION_WITHDRAWN", grant.unit_id, {
      grant_id,
      unit_id: grant.unit_id,
      reason,
      withdrawn_at: withdrawnAt,
      preserves_completed_shows: preservedShows.map((s) => s.show_id),
      future_use: "STOP_DOWNLOAD_AND_REUSE",
    });

    return {
      withdrawn_at: withdrawnAt,
      grant_id,
      preserved_shows: preservedShows.map((s) => ({ show_id: s.show_id, city: s.city, event_name: s.event_name, completed_at: s.completed_at })),
      future_use: "后续下载与复用必须停止；已签发离线包在撤销名单中失效",
    };
  }

  // ---------- 派生（翻译/剪辑） ----------

  async recordDerivation(input) {
    if (!DERIVATION_KINDS.includes(input.kind)) throw new Error(`未知派生方式: ${input.kind}`);
    const child = this.store.getUnitVersion(input.child.unit_id, input.child.version);
    const parent = this.store.getUnitVersion(input.parent.unit_id, input.parent.version);
    if (!child || !parent) throw new Error("派生两端版本必须均已登记");
    if (this.store.findDerivationByChild(input.child.unit_id, input.child.version)) {
      throw new Error("该子版本已存在派生记录");
    }
    await this.append("DERIVATION_RECORDED", input.child.unit_id, {
      derivation_id: input.derivation_id,
      kind: input.kind,
      child: { unit_id: input.child.unit_id, version: String(input.child.version) },
      parent: { unit_id: input.parent.unit_id, version: String(input.parent.version) },
      language: input.language ?? null,
      edit_note: input.edit_note ?? "",
      created_by: input.created_by ?? null,
      review_status: "PENDING",
      propagates: false, // 复核通过前不继承原许可
    });
    return this.store.findDerivationByChild(input.child.unit_id, input.child.version);
  }

  // 复核：FAITHFUL 保全原义，许可可继承；MEANING_CHANGED 改变含义，原确认不再沿用。
  async reviewDerivation({ derivation_id, verdict, note = "", reviewer = null }) {
    const edge = this.store.derivations.find((d) => d.derivation_id === derivation_id);
    if (!edge) throw new Error(`派生记录不存在: ${derivation_id}`);
    if (!["FAITHFUL", "MEANING_CHANGED"].includes(verdict)) throw new Error("verdict 必须为 FAITHFUL 或 MEANING_CHANGED");
    await this.append("TRANSLATION_REVIEWED", edge.child.unit_id, {
      derivation_id,
      verdict,
      note,
      reviewer,
      propagates: verdict === "FAITHFUL",
      reviewed_at: this.now().toISOString(),
    });
    return this.store.findDerivationByChild(edge.child.unit_id, edge.child.version);
  }

  // ---------- 节目组合与评估 ----------

  async composeProgram({ program_id, name, refs, note = "" }) {
    if (!Array.isArray(refs) || refs.length === 0) throw new Error("节目至少引用一项");
    for (const ref of refs) {
      if (!this.store.getUnitVersion(ref.unit_id, ref.version)) {
        throw new Error(`引用版本不存在: ${ref.unit_id}@${ref.version}`);
      }
    }
    await this.append("PROGRAM_COMPOSED", program_id, {
      program_id,
      name: name ?? program_id,
      refs: refs.map((r) => ({ unit_id: r.unit_id, version: String(r.version), aspects: r.aspects ?? null })),
      note,
      composed_at: this.now().toISOString(),
    });
    return this.store.programs.get(program_id);
  }

  // 带溯源与许可快照的节目评估（材料包签发与问答共用）。
  evaluate(programIdOrRefs, ctx) {
    const refs = Array.isArray(programIdOrRefs)
      ? programIdOrRefs
      : this.store.programs.get(programIdOrRefs)?.refs;
    if (!refs) throw new Error("节目不存在");
    const useCtx = { at: this.now().toISOString(), ...ctx };
    const decision = evaluateProgramPure(refs, useCtx, this.store);

    decision.items = decision.items.map((item) => {
      const version = this.store.getUnitVersion(item.ref.unit_id, item.ref.version);
      const unit = this.store.getUnit(item.ref.unit_id);
      const authority = resolveAuthority(item.ref, this.store);
      const termsByAspect = {};
      for (const d of item.decisions) {
        if (d.matched_grant) {
          // 冻结评估时刻的许可条款（离线复核按此逐项判定）。
          termsByAspect[d.aspect] = { ...this.store.getGrant(d.matched_grant), status: "ACTIVE" };
        }
      }
      return {
        ...item,
        body_hash: version?.body_hash ?? null,
        source_community: unit?.source_community ?? null,
        authority_chain: authority.chain,
        terms_by_aspect: termsByAspect,
      };
    });
    return decision;
  }

  // ---------- 离线材料包 ----------

  async issuePackage(input) {
    const refs = input.program_id
      ? this.store.programs.get(input.program_id)?.refs
      : input.refs;
    if (!refs) throw new Error("节目或引用列表缺失");

    const ctx = {
      territory: input.recipient?.territory_code ?? null,
      // 下载包签发时受众可能未知：缺省年龄维度，由离线使用方在实际受众场合复核；
      // 若调用方提供 audience_age_min，则签发即按该年龄下限收敛。
      audience_age_min: typeof input.audience_age_min === "number" ? input.audience_age_min : undefined,
      media: "DOWNLOAD",
      recording: false,
      commercial: input.commercial ?? false,
      at: this.now().toISOString(),
    };
    const decision = this.evaluate(refs, ctx);
    if (!decision.allowed) {
      const err = new Error("节目引用未全部满足许可，禁止打包下发");
      err.code = "LICENSE_DENIED";
      err.decision = decision;
      throw err;
    }

    const issuedAt = this.now().toISOString();
    const itemsForManifest = decision.items.map((item) => ({
      ...item,
      source_body_hash: item.body_hash,
      body_hash: input.files?.[`${item.ref.unit_id}@${item.ref.version}`] ? null : item.body_hash,
    }));
    const manifest = await buildManifest({
      package_id: input.package_id,
      package_version: input.package_version ?? "1.0",
      name: input.name,
      recipient: input.recipient,
      items: itemsForManifest,
      files: input.files ?? {},
      issued_at: issuedAt,
      expires_at: decision.earliest_expiry ?? null,
      issuer_id: this.issuerId,
    });
    const signature = await signManifest(this.keySet, manifest);
    const versionHash = await manifestVersionHash(manifest);

    await this.append("PACKAGE_ISSUED", input.package_id, {
      package_id: input.package_id,
      package_version: String(manifest.package_version),
      name: input.name,
      recipient: input.recipient,
      issued_at: issuedAt,
      expires_at: manifest.expires_at,
      program_refs: refs.map((r) => ({ unit_id: r.unit_id, version: String(r.version) })),
      required_attribution: decision.required_attribution,
      manifest,
      signature,
      manifest_version_hash: versionHash,
    });

    // 下载留痕 + 每一项的出现记录（城市/活动/媒介=DOWNLOAD）。
    await this.append("USE_ACKNOWLEDGED", input.package_id, {
      package_id: input.package_id,
      package_version: String(manifest.package_version),
      kind: "DOWNLOAD",
      recipient: input.recipient,
      at: issuedAt,
      grant_ids: [...new Set(decision.items.flatMap((i) => Object.values(i.terms_by_aspect).map((g) => g.grant_id)))],
    });
    for (const item of decision.items) {
      await this.recordAppearance({
        unit_id: item.ref.unit_id,
        version: String(item.ref.version),
        city: input.recipient?.city ?? null,
        territory_code: input.recipient?.territory_code ?? null,
        event_name: input.event_name ?? input.name ?? input.package_id,
        media: "DOWNLOAD",
        ref_kind: "PACKAGE",
        ref_id: input.package_id,
      });
    }

    return {
      bundle: { manifest, signature },
      manifest_version_hash: versionHash,
      public_key: this.keySet.public_key,
      expires_at: manifest.expires_at,
      required_attribution: decision.required_attribution,
    };
  }

  getPackage(packageId, version) {
    const record = this.store.packages.get(`${packageId}@${version}`);
    if (!record) return null;
    return { manifest: record.manifest, signature: record.signature };
  }

  async revokePackage({ package_id, reason = "" }) {
    await this.append("PACKAGE_REVOKED", package_id, { package_id, reason, revoked_at: this.now().toISOString() });
    return { package_id, revoked: true };
  }

  async revocationList() {
    const withdrawnGrants = [...this.store.grants.values()]
      .filter((g) => g.status === "WITHDRAWN")
      .map((g) => ({ grant_id: g.grant_id, withdrawn_at: this.withdrawnAt(g.grant_id), reason: g.withdraw_reason ?? "" }));
    const revokedPackages = [...this.store.revokedPackages.entries()].map(([package_id, v]) => ({
      package_id,
      package_version: "*",
      reason: v.reason,
      at: v.at,
    }));
    return buildRevocationList({
      version: this.ledger.entries.length,
      withdrawnGrants,
      revokedPackages,
      generated_at: this.now().toISOString(),
      keySet: this.keySet,
      issuer_id: this.issuerId,
    });
  }

  withdrawnAt(grantId) {
    const record = [...this.ledger.entries]
      .reverse()
      .find((r) => r.event.kind === "PERMISSION_WITHDRAWN" && r.event.payload.grant_id === grantId);
    return record?.event.payload.withdrawn_at ?? this.now().toISOString();
  }

  verifyOffline(bundle, options = {}) {
    return verifyPackage(bundle, { publicKey: this.keySet.public_key, ...options });
  }

  // ---------- 场次（祖父条款锚点） ----------

  async completeShow(input) {
    const refs = input.program_id ? this.store.programs.get(input.program_id)?.refs : input.refs;
    if (!refs) throw new Error("场次必须关联节目或引用列表");
    const ctx = {
      territory: input.territory_code,
      audience_age_min: input.audience_age_min ?? 0,
      media: "LIVE",
      recording: input.recording ?? false,
      commercial: input.commercial ?? false,
      at: input.completed_at ?? this.now().toISOString(),
    };
    const decision = this.evaluate(refs, ctx);
    if (!decision.allowed) {
      const err = new Error("该场次不满足全部许可，不得记为依法完成的场次");
      err.code = "LICENSE_DENIED";
      err.decision = decision;
      throw err;
    }
    await this.append("SHOW_COMPLETED", input.show_id, {
      show_id: input.show_id,
      program_id: input.program_id ?? null,
      event_name: input.event_name,
      city: input.city,
      territory_code: input.territory_code,
      completed_at: ctx.at,
      recording: ctx.recording,
      refs: refs.map((r) => ({ unit_id: r.unit_id, version: String(r.version) })),
      grant_ids: [...new Set(decision.items.flatMap((i) => Object.values(i.terms_by_aspect).map((g) => g.grant_id)))],
    });
    for (const ref of refs) {
      await this.recordAppearance({
        unit_id: ref.unit_id,
        version: String(ref.version),
        city: input.city,
        territory_code: input.territory_code,
        event_name: input.event_name,
        media: "LIVE",
        ref_kind: "SHOW",
        ref_id: input.show_id,
      });
    }
    return { show_id: input.show_id, recorded: true, decision };
  }

  // ---------- 讲解员问答 ----------

  async docentAnswer(input) {
    const program = this.store.programs.get(input.program_id);
    if (!program) throw new Error(`节目不存在: ${input.program_id}`);
    const session = {
      city: input.session?.city ?? null,
      territory_code: input.session?.territory_code ?? null,
      audience_age_min: input.session?.audience_age_min ?? 0,
      recording: input.session?.recording ?? false,
      commercial: input.session?.commercial ?? false,
      docent_id: input.session?.docent_id ?? null,
    };
    const decision = this.evaluate(program.program_id, {
      territory: session.territory_code,
      audience_age_min: session.audience_age_min,
      media: "LIVE_QA",
      recording: session.recording,
      commercial: session.commercial,
    });

    const verdict = this.guard.evaluate({
      question: input.question,
      unit_ref: input.unit_ref,
      programDecision: decision,
      session,
      roleAspects: input.role_aspects ?? {},
    });

    const payload = {
      docent_id: session.docent_id,
      program_id: input.program_id,
      show_id: input.show_id ?? null,
      city: session.city,
      territory_code: session.territory_code,
      unit_ref: input.unit_ref ?? null,
      question: input.question,
      triggered_aspects: verdict.triggered_aspects,
      allow: verdict.allow,
      speakable_aspects: verdict.speakable_aspects,
      blocks: verdict.blocks,
      response: verdict.response,
    };
    await this.append(verdict.allow ? "ANSWER_GIVEN" : "ANSWER_GUARDED", session.docent_id ?? "docent", payload);
    if (verdict.allow && input.unit_ref) {
      await this.recordAppearance({
        unit_id: input.unit_ref.unit_id,
        version: String(input.unit_ref.version),
        city: session.city,
        territory_code: session.territory_code,
        event_name: program.name,
        media: "LIVE_QA",
        ref_kind: "QA",
        ref_id: input.show_id ?? input.program_id,
      });
    }
    return verdict;
  }

  // ---------- 争议与替代素材 ----------

  async recordDispute(input) {
    if (this.store.disputes.has(input.dispute_id)) throw new Error("争议编号已存在");
    await this.append("DISPUTE_RECORDED", input.dispute_id, {
      dispute_id: input.dispute_id,
      unit_ref: input.unit_ref ?? null,
      raised_by: input.raised_by, // 共同体/传承人/学校
      reason: input.reason,
      severity: input.severity ?? "NORMAL",
      city: input.city ?? null,
      event_name: input.event_name ?? null,
      hold_future_use: input.hold_future_use ?? true, // 争议期间暂停后续复用
      opened_at: this.now().toISOString(),
    });
    return this.store.disputes.get(input.dispute_id);
  }

  async linkSubstitute({ dispute_id, substitute, note = "" }) {
    if (!this.store.disputes.has(dispute_id)) throw new Error("争议不存在");
    if (!this.store.getUnitVersion(substitute.unit_id, substitute.version)) throw new Error("替代素材版本不存在");
    await this.append("SUBSTITUTE_LINKED", dispute_id, {
      dispute_id,
      substitute: { unit_id: substitute.unit_id, version: String(substitute.version) },
      note,
      linked_at: this.now().toISOString(),
    });
    return this.store.disputes.get(dispute_id);
  }

  async resolveDispute({ dispute_id, outcome, note = "" }) {
    if (!this.store.disputes.has(dispute_id)) throw new Error("争议不存在");
    if (!["UPHELD", "RELEASED"].includes(outcome)) throw new Error("outcome 必须为 UPHELD（维持限制）或 RELEASED（解除暂停）");
    await this.append("DISPUTE_RESOLVED", dispute_id, {
      dispute_id,
      outcome,
      note,
      resolved_at: this.now().toISOString(),
    });
    return this.store.disputes.get(dispute_id);
  }

  listDisputes() {
    return [...this.store.disputes.values()];
  }

  // ---------- 出现记录与溯源视图 ----------

  async recordAppearance(input) {
    if (!input.event_name || !input.media) throw new Error("出现记录需要活动名与媒介");
    if (!MEDIA.includes(input.media)) throw new Error(`未知媒介: ${input.media}`);
    await this.append("APPEARANCE_RECORDED", input.unit_id, {
      unit_id: input.unit_id,
      version: input.version ? String(input.version) : null,
      city: input.city ?? null,
      territory_code: input.territory_code ?? null,
      event_name: input.event_name,
      media: input.media,
      ref_kind: input.ref_kind ?? null,
      ref_id: input.ref_id ?? null,
    });
  }

  // 传承人视图：某段知识在“哪座城市、哪次活动、哪种媒介”出现过。
  appearancesOf(unitId, { media = null, includeVersions = true } = {}) {
    const rows = this.store.appearances
      .filter((a) => a.unit_id === unitId || (includeVersions && a.unit_id === unitId))
      .filter((a) => !media || a.media === media)
      .map((a) => ({
        version: a.version,
        city: a.city,
        territory_code: a.territory_code,
        event_name: a.event_name,
        media: a.media,
        via: a.ref_kind,
        ref_id: a.ref_id,
        at: a.at,
      }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const byCity = {};
    for (const row of rows) {
      const key = `${row.city ?? "未知城市"} / ${row.event_name}`;
      byCity[key] ??= { city: row.city, event_name: row.event_name, media: new Set(), appearances: 0 };
      byCity[key].media.add(row.media);
      byCity[key].appearances += 1;
    }
    return {
      unit_id: unitId,
      title: this.store.getUnit(unitId)?.title ?? null,
      total: rows.length,
      timeline: rows,
      by_city_event: Object.values(byCity).map((g) => ({ ...g, media: [...g.media] })),
    };
  }

  // 单元全量谱系：版本、派生链、许可状态、出现次数。
  lineageOf(unitId) {
    const unit = this.store.getUnit(unitId);
    if (!unit) return null;
    return {
      unit_id: unitId,
      title: unit.title,
      kind: unit.kind,
      source_community: unit.source_community,
      custodian: unit.custodian,
      versions: unit.versions.map((v) => {
        const ver = this.store.getUnitVersion(unitId, v);
        return {
          version: v,
          sensitivity: ver.sensitivity,
          aspects: ver.aspects,
          body_hash: ver.body_hash,
          grants: this.store.grantsFor(unitId, v).map((g) => ({
            grant_id: g.grant_id,
            status: g.status,
            territories: g.territories,
            media: g.media,
            commercial: g.commercial,
            recording: g.recording,
            min_age: g.min_age,
            expires_at: g.expires_at,
            attribution: g.attribution,
            aspects: g.aspects,
          })),
        };
      }),
      derivations: this.store.derivations
        .filter((d) => d.child.unit_id === unitId || d.parent.unit_id === unitId)
        .map((d) => ({
          derivation_id: d.derivation_id,
          kind: d.kind,
          child: d.child,
          parent: d.parent,
          review_status: d.review_status,
          verdict: d.verdict ?? null,
          propagates: d.propagates,
        })),
      appearances: this.appearancesOf(unitId).total,
    };
  }

  async verifyLedger() {
    return this.ledger.verify();
  }

  status() {
    return {
      ledger_events: this.ledger.entries.length,
      ledger_tip: this.ledger.tip,
      units: this.store.units.size,
      active_grants: [...this.store.grants.values()].filter((g) => g.status === "ACTIVE").length,
      withdrawn_grants: [...this.store.grants.values()].filter((g) => g.status === "WITHDRAWN").length,
      packages: this.store.packages.size,
      revoked_packages: this.store.revokedPackages.size,
      completed_shows: this.store.shows.length,
      open_disputes: [...this.store.disputes.values()].filter((d) => d.status === "OPEN").length,
      appearances: this.store.appearances.length,
    };
  }
}

function bumpVersion(version) {
  const parts = String(version ?? "1.0").split(".");
  const last = Number(parts.at(-1));
  parts[parts.length - 1] = String(Number.isFinite(last) ? last + 1 : 1);
  return parts.join(".");
}
