// 跨境展演知识边界服务。
//
// 核心规则：
// 1. 知识拆成五类单元，各自注明来源共同体、可公开地域、受众年龄、
//    署名、录制、商业用途与到期日。
// 2. 节目引用任意单元，必须同时满足全部许可（联合许可取交集）。
// 3. 翻译或剪辑改变含义后，原确认不再沿用，须重新确认；源头改义会波及衍生单元。
// 4. 离线材料包带可验证版本（内容哈希）与自动失效信息（到期日）。
// 5. 讲解员临场提问只能在节目获准范围内回答，超范围拒答并留痕。
// 6. 许可撤回不否定已依法完成的场次，但后续下载与复用必须停止；
//    争议与替代素材持续留痕。
// 7. 传承人可以查到某段知识在哪座城市、哪次活动、哪种媒介中出现过。
import { Ledger, canonicalize, sha256 } from "./ledger.js";
import { UNIT_KINDS, composeLicenses, licenseCovers, validateLicense } from "./units.js";

const DAY_MS = 24 * 3600 * 1000;

export class KnowledgeBoundaryService {
  constructor({ now } = {}) {
    this.ledger = new Ledger();
    this.units = new Map();
    this.programs = new Map();
    this.packages = new Map();
    this._now = now ?? (() => new Date().toISOString());
    this._seq = 0;
  }

  _emit(kind, subject_id, payload) {
    this._seq += 1;
    return this.ledger.append({
      event_id: `E${String(this._seq).padStart(6, "0")}`,
      kind,
      occurred_at: this._now(),
      subject_id,
      payload,
    });
  }

  _unit(unit_id) {
    const unit = this.units.get(unit_id);
    if (!unit) throw new Error(`未知知识单元: ${unit_id}`);
    return unit;
  }

  // 单元当前是否可用：已确认、确认绑定当前内容版本、未撤回、未到期。
  _usabilityProblems(unit_ids, at) {
    const problems = [];
    for (const unit_id of unit_ids) {
      const unit = this.units.get(unit_id);
      if (!unit) {
        problems.push(`未知知识单元: ${unit_id}`);
        continue;
      }
      if (unit.status === "WITHDRAWN") {
        problems.push(`许可已撤回: ${unit_id}`);
        continue;
      }
      const confirmed =
        unit.status === "ACTIVE" &&
        unit.confirmation !== null &&
        unit.confirmation.content_hash === unit.content_hash;
      if (!confirmed) {
        problems.push(`未经有效确认: ${unit_id}（${unit.status}）`);
        continue;
      }
      if (unit.license.expires_at && Date.parse(at) > Date.parse(unit.license.expires_at)) {
        problems.push(`许可已到期: ${unit_id}`);
      }
    }
    return problems;
  }

  // 1. 登记知识单元。content 为任意可序列化内容，以其哈希标识版本。
  registerKnowledgeUnit(draft) {
    const problems = [];
    if (!draft.unit_id) problems.push("unit_id");
    if (draft.unit_id && this.units.has(draft.unit_id)) problems.push("unit_id 已存在");
    if (!UNIT_KINDS.includes(draft.kind)) problems.push("kind");
    if (!draft.title) problems.push("title");
    if (!draft.community) problems.push("community");
    problems.push(...validateLicense(draft.license));
    if (draft.content === undefined || draft.content === null) problems.push("content");
    if (draft.derived_from && !this.units.has(draft.derived_from)) {
      problems.push("derived_from 指向未知单元");
    }
    if (problems.length > 0) throw new Error(`知识单元登记失败: ${problems.join(", ")}`);

    const unit = {
      unit_id: draft.unit_id,
      kind: draft.kind,
      title: draft.title,
      community: draft.community,
      license: structuredClone(draft.license),
      content: structuredClone(draft.content),
      content_hash: sha256(canonicalize(draft.content)),
      version: 1,
      derived_from: draft.derived_from ?? null,
      status: "PENDING_CONFIRMATION",
      confirmation: null,
    };
    this.units.set(unit.unit_id, unit);
    this._emit("KNOWLEDGE_REGISTERED", unit.unit_id, {
      unit_id: unit.unit_id,
      kind: unit.kind,
      title: unit.title,
      community: unit.community,
      license: unit.license,
      version: unit.version,
      content_hash: unit.content_hash,
      derived_from: unit.derived_from,
    });
    return unit;
  }

  // 2. 来源共同体/传承人确认：确认绑定当前内容哈希。
  confirmUnit(unit_id, { confirmer, note = "" } = {}) {
    const unit = this._unit(unit_id);
    if (unit.status === "WITHDRAWN") throw new Error(`许可已撤回，无法确认: ${unit_id}`);
    unit.confirmation = {
      confirmer: confirmer ?? unit.community,
      confirmed_at: this._now(),
      content_hash: unit.content_hash,
      note,
    };
    unit.status = "ACTIVE";
    const kind = unit.kind === "TRANSLATION" ? "TRANSLATION_REVIEWED" : "UNIT_CONFIRMED";
    this._emit(kind, unit_id, { ...unit.confirmation, version: unit.version });
    return unit;
  }

  // 3. 翻译或剪辑修订内容。meaning_changed 为真时原确认不再沿用，
  //    单元进入 NEEDS_REVIEW；直接衍生单元（如源故事的译文）一并失效。
  reviseUnitContent(unit_id, { content, editor, meaning_changed = true, note = "" } = {}) {
    const unit = this._unit(unit_id);
    if (unit.status === "WITHDRAWN") throw new Error(`许可已撤回，无法修订: ${unit_id}`);
    const previous_hash = unit.content_hash;
    unit.content = structuredClone(content);
    unit.content_hash = sha256(canonicalize(content));
    unit.version += 1;
    if (meaning_changed) {
      unit.confirmation = null;
      unit.status = "NEEDS_REVIEW";
    } else if (unit.confirmation) {
      // 未改义的修订（如错别字）沿用原确认，仅更新绑定的版本哈希。
      unit.confirmation.content_hash = unit.content_hash;
    }
    this._emit("UNIT_CONTENT_REVISED", unit_id, {
      version: unit.version,
      content_hash: unit.content_hash,
      previous_hash,
      editor,
      meaning_changed,
      note,
    });
    if (meaning_changed) {
      for (const other of this.units.values()) {
        if (other.derived_from === unit_id && other.status !== "WITHDRAWN") {
          other.confirmation = null;
          other.status = "NEEDS_REVIEW";
          this._emit("UNIT_CONTENT_REVISED", other.unit_id, {
            version: other.version,
            content_hash: other.content_hash,
            trigger: "SOURCE_REVISED",
            source_unit_id: unit_id,
            meaning_changed: true,
            note: "源头内容改义，衍生单元原确认不再沿用",
          });
        }
      }
    }
    return unit;
  }

  // 4. 节目获准：引用的全部单元必须可用，且联合许可覆盖演出场景。
  approveProgram({ program_id, unit_ids, context = {} }) {
    if (this.programs.has(program_id)) throw new Error(`节目已存在: ${program_id}`);
    const at = this._now();
    const problems = this._usabilityProblems(unit_ids, at);
    if (problems.length > 0) throw new Error(`节目未获批准: ${problems.join("；")}`);
    const joint = composeLicenses(unit_ids.map((id) => this.units.get(id)));
    const cover = licenseCovers(joint, { ...context, at });
    if (!cover.ok) throw new Error(`节目未获批准: ${cover.problems.join("；")}`);
    const program = {
      program_id,
      unit_ids: [...unit_ids],
      context,
      joint_license: joint,
      approved_at: at,
    };
    this.programs.set(program_id, program);
    this._emit("PROGRAM_APPROVED", program_id, {
      program_id,
      unit_ids,
      context,
      joint_license: joint,
    });
    return program;
  }

  // 5. 签发离线材料包：清单记录每个单元的版本与内容哈希，
  //    到期日取联合许可到期日与包有效期（默认 30 天）的较早者，到期自动失效。
  issuePackage({ package_id, unit_ids, context = {}, ttl_days = 30 }) {
    if (this.packages.has(package_id)) throw new Error(`材料包已存在: ${package_id}`);
    const issued_at = this._now();
    const problems = this._usabilityProblems(unit_ids, issued_at);
    if (problems.length > 0) throw new Error(`材料包签发失败: ${problems.join("；")}`);
    const units = unit_ids.map((id) => this.units.get(id));
    const joint = composeLicenses(units);
    const cover = licenseCovers(joint, { ...context, at: issued_at });
    if (!cover.ok) throw new Error(`材料包签发失败: ${cover.problems.join("；")}`);

    const manifest = units.map((unit) => ({
      unit_id: unit.unit_id,
      kind: unit.kind,
      title: unit.title,
      community: unit.community,
      version: unit.version,
      content_hash: unit.content_hash,
    }));
    const ttl_expires = new Date(Date.parse(issued_at) + ttl_days * DAY_MS).toISOString();
    const expires_at = [joint.expires_at, ttl_expires].filter(Boolean).sort()[0];
    const core = { package_id, manifest, context, issued_at, expires_at };
    const pkg = {
      ...core,
      version: 1,
      auto_expire: true,
      joint_license: joint,
      package_hash: sha256(canonicalize(core)),
    };
    this.packages.set(package_id, pkg);
    this._emit("PACKAGE_ISSUED", package_id, {
      package_id,
      unit_ids,
      expires_at,
      package_hash: pkg.package_hash,
      manifest,
    });
    return structuredClone(pkg);
  }

  // 6. 验证离线材料包：版本哈希、签发记录、自动失效、撤回与版本漂移。
  verifyPackage(package_id, at = this._now()) {
    const pkg = this.packages.get(package_id);
    if (!pkg) return { valid: false, problems: [`未知材料包: ${package_id}`] };
    const problems = [];
    const core = {
      package_id: pkg.package_id,
      manifest: pkg.manifest,
      context: pkg.context,
      issued_at: pkg.issued_at,
      expires_at: pkg.expires_at,
    };
    if (sha256(canonicalize(core)) !== pkg.package_hash) {
      problems.push("材料包内容被篡改，版本校验失败");
    }
    const issued = this.ledger
      .ofKind("PACKAGE_ISSUED")
      .find((event) => event.payload.package_id === package_id);
    if (issued && issued.payload.package_hash !== pkg.package_hash) {
      problems.push("材料包与签发记录不符");
    }
    if (Date.parse(at) > Date.parse(pkg.expires_at)) {
      problems.push(`材料包已于 ${pkg.expires_at} 自动失效`);
    }
    for (const item of pkg.manifest) {
      const unit = this.units.get(item.unit_id);
      if (!unit) {
        problems.push(`知识单元不存在: ${item.unit_id}`);
      } else if (unit.status === "WITHDRAWN") {
        problems.push(`许可已撤回，禁止继续下载与复用: ${item.unit_id}`);
      } else if (unit.content_hash !== item.content_hash) {
        problems.push(`知识单元已有新版本，材料包需重新签发: ${item.unit_id}`);
      }
    }
    return { valid: problems.length === 0, problems };
  }

  // 7. 下载离线材料包：校验不通过即拒绝；通过则留痕。
  downloadPackage(package_id, { by = "anonymous" } = {}) {
    const result = this.verifyPackage(package_id);
    if (!result.valid) throw new Error(`材料包下载被拒绝: ${result.problems.join("；")}`);
    this._emit("PACKAGE_DOWNLOADED", package_id, { package_id, by });
    return structuredClone(this.packages.get(package_id));
  }

  // 8. 场次使用确认：城市、活动、媒介留痕，是传承人溯源视图的来源。
  acknowledgeUse({ program_id, city, event_name, medium, audience_age, unit_ids }) {
    const program = this.programs.get(program_id);
    if (!program) throw new Error(`未知节目: ${program_id}`);
    const at = this._now();
    const used = unit_ids ?? program.unit_ids;
    const outside = used.filter((id) => !program.unit_ids.includes(id));
    if (outside.length > 0) {
      throw new Error(`场次引用了节目未获准的单元: ${outside.join(", ")}`);
    }
    const problems = this._usabilityProblems(used, at);
    problems.push(
      ...licenseCovers(program.joint_license, {
        ...program.context,
        audience_age: audience_age ?? program.context.audience_age,
        at,
      }).problems,
    );
    if (problems.length > 0) throw new Error(`场次使用不被允许: ${problems.join("；")}`);
    return this._emit("USE_ACKNOWLEDGED", program_id, {
      program_id,
      unit_ids: used,
      city,
      event_name,
      medium,
      audience_age: audience_age ?? null,
    });
  }

  // 9. 讲解员临场问答：只能引用节目已获准的单元，且场景仍在联合许可范围内。
  answerQuestion({ program_id, docent, question, unit_ids, context = {} }) {
    const program = this.programs.get(program_id);
    if (!program) throw new Error(`未知节目: ${program_id}`);
    const at = this._now();
    const problems = [];
    const outside = unit_ids.filter((id) => !program.unit_ids.includes(id));
    if (outside.length > 0) problems.push(`问题超出节目获准范围: ${outside.join(", ")}`);
    problems.push(...this._usabilityProblems(unit_ids, at));
    const inScope = unit_ids
      .filter((id) => program.unit_ids.includes(id))
      .map((id) => this.units.get(id))
      .filter(Boolean);
    if (inScope.length > 0) {
      const joint = composeLicenses(inScope);
      problems.push(...licenseCovers(joint, { ...program.context, ...context, at }).problems);
    }
    if (problems.length > 0) {
      this._emit("QUESTION_REFUSED", program_id, { docent, question, unit_ids, problems });
      return { allowed: false, problems };
    }
    this._emit("QUESTION_ANSWERED", program_id, { docent, question, unit_ids });
    return { allowed: true, problems: [] };
  }

  // 10. 许可撤回：不否定已依法完成的场次，但后续下载与复用必须停止。
  withdrawPermission(unit_id, { reason = "", by } = {}) {
    const unit = this._unit(unit_id);
    if (unit.status === "WITHDRAWN") throw new Error(`许可已撤回: ${unit_id}`);
    unit.status = "WITHDRAWN";
    unit.confirmation = null;
    this._emit("PERMISSION_WITHDRAWN", unit_id, {
      unit_id,
      reason,
      by: by ?? unit.community,
      note: "撤回不否定已依法完成的场次；后续下载与复用必须停止",
    });
    return unit;
  }

  // 11. 争议与替代素材：持续留痕，不删除历史。
  raiseDispute({ unit_id, raised_by, detail }) {
    this._unit(unit_id);
    return this._emit("DISPUTE_RAISED", unit_id, { unit_id, raised_by, detail });
  }

  proposeSubstitute({ disputed_unit_id, substitute_unit_id, note = "" }) {
    this._unit(disputed_unit_id);
    this._unit(substitute_unit_id);
    return this._emit("SUBSTITUTE_PROPOSED", disputed_unit_id, {
      disputed_unit_id,
      substitute_unit_id,
      note,
    });
  }

  // 12. 溯源：某段知识在哪座城市、哪次活动、哪种媒介中出现过。
  appearancesOf(unit_id) {
    const withdrawn = this.ledger
      .ofKind("PERMISSION_WITHDRAWN")
      .find((event) => event.payload.unit_id === unit_id);
    return this.ledger
      .ofKind("USE_ACKNOWLEDGED")
      .filter((event) => event.payload.unit_ids.includes(unit_id))
      .map((event) => ({
        city: event.payload.city,
        event_name: event.payload.event_name,
        medium: event.payload.medium,
        program_id: event.payload.program_id,
        occurred_at: event.occurred_at,
        // 使用在登记时已通过联合许可校验；撤回前完成的场次保持合法。
        lawful: true,
        before_withdrawal: withdrawn
          ? Date.parse(event.occurred_at) <= Date.parse(withdrawn.occurred_at)
          : null,
      }));
  }

  // 传承人视图：单元现状 + 出现记录 + 争议/替代/撤回 + 完整事件史。
  unitReport(unit_id) {
    const unit = this._unit(unit_id);
    return {
      unit,
      appearances: this.appearancesOf(unit_id),
      disputes: this.ledger.ofKind("DISPUTE_RAISED").filter((e) => e.payload.unit_id === unit_id),
      substitutes: this.ledger
        .ofKind("SUBSTITUTE_PROPOSED")
        .filter((e) => e.payload.disputed_unit_id === unit_id || e.payload.substitute_unit_id === unit_id),
      withdrawals: this.ledger
        .ofKind("PERMISSION_WITHDRAWN")
        .filter((e) => e.payload.unit_id === unit_id),
      history: this.ledger.bySubject(unit_id),
    };
  }

  verifyLedger() {
    return this.ledger.verify();
  }
}
