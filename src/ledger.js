// 追加式事件账本：每条事件带序号与前一条的哈希，形成可校验的链。
// 任何对历史事件的篡改都会在 verify() 中暴露，用于争议留痕与审计。
import { createHash } from "node:crypto";
import { EVENT_KINDS, validateEvent } from "./heritage_exchange_boundary.js";

// 键序稳定的序列化，保证同一对象永远得到同一哈希。
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export class Ledger {
  constructor() {
    this.events = [];
  }

  append({ event_id, kind, occurred_at, subject_id, payload }) {
    if (!EVENT_KINDS.includes(kind)) throw new Error(`未知事件种类: ${kind}`);
    const record = { event_id, kind, occurred_at, subject_id, payload };
    const problems = validateEvent(record);
    if (problems.length > 0) throw new Error(`事件不符合领域约定: ${problems.join(", ")}`);
    const seq = this.events.length;
    const prev_hash = seq === 0 ? null : this.events[seq - 1].hash;
    const core = { seq, prev_hash, ...record };
    const event = { ...core, hash: sha256(canonicalize(core)) };
    this.events.push(event);
    return event;
  }

  verify() {
    const problems = [];
    this.events.forEach((event, index) => {
      if (event.seq !== index) problems.push(`序号不连续: ${event.event_id}`);
      const expectedPrev = index === 0 ? null : this.events[index - 1].hash;
      if (event.prev_hash !== expectedPrev) problems.push(`链式哈希断裂: ${event.event_id}`);
      const { hash, ...core } = event;
      if (sha256(canonicalize(core)) !== hash) problems.push(`事件内容被篡改: ${event.event_id}`);
    });
    return problems;
  }

  ofKind(kind) {
    return this.events.filter((event) => event.kind === kind);
  }

  bySubject(subject_id) {
    return this.events.filter((event) => event.subject_id === subject_id);
  }
}
