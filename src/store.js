// 事件回放得到的只读查询模型（供 permissions.js 使用）。
//
// 不直接落库业务表：服务每次从账本事件重放出单元版本、许可、派生边、
// 节目、场次、争议等状态。撤回表现为许可 status=WITHDRAWN，旧事件仍在。

import { UNIT_KINDS, SENSITIVITY } from "./heritage_exchange_boundary.js";

export class Store {
  constructor() {
    this.units = new Map(); // unit_id -> {unit}
    this.versions = new Map(); // `${unit_id}@${version}` -> version
    this.grants = new Map(); // grant_id -> grant
    this.grantsByUnit = new Map(); // unit_id -> [grant]
    this.derivations = []; // edge（孩子 -> 父本）
    this.programs = new Map(); // program_id -> program
    this.packages = new Map(); // `${package_id}@${version}` -> {manifest, signature, recipient}
    this.revokedPackages = new Map(); // package_id -> {reason, at}
    this.shows = []; // 已依法完成的场次
    this.answers = []; // 问答留痕
    this.disputes = new Map(); // dispute_id -> dispute
    this.uses = []; // 下载/复用留痕
    this.appearances = []; // 出现记录（城市/活动/媒介）
  }

  static replay(events) {
    const store = new Store();
    for (const e of events) store.apply(e);
    return store;
  }

  apply(event) {
    const p = event.payload;
    switch (event.kind) {
      case "KNOWLEDGE_REGISTERED":
      case "KNOWLEDGE_UPDATED": {
        if (!this.units.has(p.unit_id)) {
          this.units.set(p.unit_id, {
            unit_id: p.unit_id,
            kind: p.kind,
            title: p.title,
            source_community: p.source_community,
            custodian: p.custodian,
            created_event: event.event_id,
            versions: [],
          });
          this.grantsByUnit.set(p.unit_id, []);
        }
        const unit = this.units.get(p.unit_id);
        const vkey = `${p.unit_id}@${p.version}`;
        if (!this.versions.has(vkey)) {
          this.versions.set(vkey, {
            unit_id: p.unit_id,
            version: p.version,
            kind: p.kind,
            title: p.title,
            sensitivity: p.sensitivity,
            aspects: p.aspects ?? [],
            body_hash: p.body_hash ?? null,
            content_uri: p.content_uri ?? null,
            registered_event: event.event_id,
            registered_at: event.occurred_at,
          });
          unit.versions.push(p.version);
        }
        unit.title = p.title;
        break;
      }
      case "PERMISSION_GRANTED": {
        const grant = { ...p, status: "ACTIVE", granted_event: event.event_id };
        this.grants.set(p.grant_id, grant);
        this.grantsByUnit.get(p.unit_id)?.push(grant);
        break;
      }
      case "PERMISSION_WITHDRAWN": {
        const grant = this.grants.get(p.grant_id);
        if (grant) {
          grant.status = "WITHDRAWN";
          grant.withdraw_reason = p.reason ?? "";
          grant.withdrawn_at = p.withdrawn_at ?? event.occurred_at;
        }
        break;
      }
      case "DERIVATION_RECORDED": {
        this.derivations.push({ ...p, recorded_event: event.event_id });
        break;
      }
      case "TRANSLATION_REVIEWED": {
        const edge = this.derivations.find((d) => d.derivation_id === p.derivation_id);
        if (edge) {
          edge.review_status = "REVIEWED";
          edge.verdict = p.verdict; // FAITHFUL | MEANING_CHANGED
          edge.propagates = p.propagates ?? p.verdict === "FAITHFUL";
          edge.review_note = p.note ?? "";
          edge.review_event = event.event_id;
        }
        break;
      }
      case "PROGRAM_COMPOSED": {
        this.programs.set(p.program_id, { ...p, composed_event: event.event_id });
        break;
      }
      case "PACKAGE_ISSUED": {
        this.packages.set(`${p.package_id}@${p.package_version}`, {
          package_id: p.package_id,
          package_version: p.package_version,
          name: p.name,
          recipient: p.recipient,
          issued_at: p.issued_at,
          expires_at: p.expires_at,
          manifest: p.manifest,
          signature: p.signature,
          program_refs: p.program_refs,
          event_id: event.event_id,
        });
        break;
      }
      case "PACKAGE_REVOKED": {
        this.revokedPackages.set(p.package_id, { reason: p.reason, at: event.occurred_at });
        break;
      }
      case "SHOW_COMPLETED": {
        this.shows.push({ ...p, event_id: event.event_id, completed_at: event.occurred_at });
        break;
      }
      case "ANSWER_GIVEN":
      case "ANSWER_GUARDED": {
        this.answers.push({ ...p, event_id: event.event_id, at: event.occurred_at });
        break;
      }
      case "DISPUTE_RECORDED": {
        this.disputes.set(p.dispute_id, { ...p, status: "OPEN", event_id: event.event_id });
        break;
      }
      case "SUBSTITUTE_LINKED": {
        const dispute = this.disputes.get(p.dispute_id);
        if (dispute) {
          dispute.substitutes = dispute.substitutes ?? [];
          dispute.substitutes.push({ ref: p.substitute, note: p.note, at: event.occurred_at });
        }
        break;
      }
      case "DISPUTE_RESOLVED": {
        const dispute = this.disputes.get(p.dispute_id);
        if (dispute) {
          dispute.status = p.outcome === "UPHELD" ? "RESOLVED_RESTRICTED" : "RESOLVED";
          dispute.resolution = { outcome: p.outcome, note: p.note, at: event.occurred_at };
        }
        break;
      }
      case "USE_ACKNOWLEDGED": {
        this.uses.push({ ...p, event_id: event.event_id, at: event.occurred_at ?? p.at });
        break;
      }
      case "APPEARANCE_RECORDED": {
        this.appearances.push({ ...p, event_id: event.event_id, at: event.occurred_at });
        break;
      }
      default:
        break;
    }
  }

  getUnit(unitId) {
    return this.units.get(unitId) ?? null;
  }

  getUnitVersion(unitId, version) {
    return this.versions.get(`${unitId}@${version}`) ?? null;
  }

  getGrant(grantId) {
    return this.grants.get(grantId) ?? null;
  }

  grantsFor(unitId, version = null) {
    const list = this.grantsByUnit.get(unitId) ?? [];
    return version ? list.filter((g) => String(g.version) === String(version)) : list;
  }

  findDerivationByChild(unitId, version) {
    return (
      this.derivations.find(
        (d) => d.child.unit_id === unitId && String(d.child.version) === String(version),
      ) ?? null
    );
  }
}

// 登记输入的基础校验：在写账本前尽早拒绝明显非法的资料。
export function validateUnitInput(input) {
  const problems = [];
  if (!input.unit_id) problems.push("unit_id");
  if (!UNIT_KINDS.includes(input.kind)) problems.push("kind");
  if (!input.title) problems.push("title");
  if (!input.source_community?.community_id) problems.push("source_community.community_id");
  if (!input.sensitivity || !SENSITIVITY.includes(input.sensitivity)) problems.push("sensitivity");
  if (!Array.isArray(input.aspects) || input.aspects.length === 0) problems.push("aspects");
  return problems;
}

export function validateGrantInput(input) {
  const problems = [];
  if (!input.grant_id) problems.push("grant_id");
  if (!input.unit_id) problems.push("unit_id");
  if (!Array.isArray(input.territories) || input.territories.length === 0) problems.push("territories");
  if (!Array.isArray(input.media) || input.media.length === 0) problems.push("media");
  if (!["PROHIBITED", "ALLOWED"].includes(input.recording)) problems.push("recording");
  if (typeof input.commercial !== "boolean") problems.push("commercial");
  if (!Array.isArray(input.aspects) || input.aspects.length === 0) problems.push("aspects");
  if (!input.attribution) problems.push("attribution");
  if (!input.confirmer) problems.push("confirmer");
  return problems;
}
