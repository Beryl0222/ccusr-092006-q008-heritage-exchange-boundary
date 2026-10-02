// 防篡改追加账本：所有领域动作先落成事件，再写入 JSONL。
//
// 每条记录携带前一条记录的哈希，形成哈希链；改写、删除或乱序插入
// 都会在 verify() 中暴露。账本只追加、不修改，撤回通过新事件表达，
// 而不是删掉旧的许可事件。

import { createReadStream } from "node:fs";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import readline from "node:readline";
import { canonicalJSON, hashCanonical } from "./crypto.js";
import { validateEvent } from "./heritage_exchange_boundary.js";

const GENESIS = "0".repeat(64);

export class Ledger {
  constructor(path, clock = () => new Date()) {
    this.path = path;
    this.clock = clock;
    this.entries = [];
    this.tip = GENESIS;
  }

  async load() {
    this.entries = [];
    this.tip = GENESIS;
    try {
      const stream = createReadStream(this.path, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        this.entries.push(record);
        this.tip = record.hash;
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return this;
  }

  // 校验整条哈希链：事件字段合法、前驱哈希相接、自身哈希可复验。
  // {ok, count, tip, error(第一条断裂处)}
  async verify() {
    let prev = GENESIS;
    for (const [i, record] of this.entries.entries()) {
      const problems = validateEvent(record.event);
      if (problems.length) {
        return { ok: false, count: this.entries.length, tip: this.tip, error: `#${i} 事件字段缺失: ${problems.join(",")}` };
      }
      if (record.prev_hash !== prev) {
        return { ok: false, count: this.entries.length, tip: this.tip, error: `#${i} 前驱哈希断裂` };
      }
      const expected = await hashCanonical({ seq: record.seq, event: record.event, prev_hash: record.prev_hash });
      if (expected !== record.hash) {
        return { ok: false, count: this.entries.length, tip: this.tip, error: `#${i} 内容哈希不符（记录可能被改写）` };
      }
      prev = record.hash;
    }
    return { ok: true, count: this.entries.length, tip: this.tip };
  }

  // 追加一条事件。重复 event_id 会被拒绝（防止重放）。
  async append(kind, subjectId, payload, { eventId, occurredAt } = {}) {
    if (this.entries.some((r) => r.event.event_id === eventId)) {
      throw new Error(`事件重复: ${eventId}`);
    }
    const event = {
      event_id: eventId ?? `evt_${this.entries.length + 1}_${Math.random().toString(36).slice(2, 8)}`,
      kind,
      occurred_at: (occurredAt ?? this.clock()).toISOString?.() ?? occurredAt,
      subject_id: subjectId,
      payload,
    };
    const problems = validateEvent(event);
    if (problems.length) throw new Error(`非法事件，字段缺失: ${problems.join(",")}`);

    const record = { seq: this.entries.length, event, prev_hash: this.tip };
    record.hash = await hashCanonical({ seq: record.seq, event: record.event, prev_hash: record.prev_hash });

    await mkdir(dirname(this.path), { recursive: true });
    // 先写临时文件再正式追加不可行（append 本身是原子写）；崩溃时损坏行会被 verify 抓到。
    await appendFile(this.path, canonicalJSON(record) + "\n", "utf8");
    this.entries.push(record);
    this.tip = record.hash;
    return record;
  }

  events() {
    return this.entries.map((r) => r.event);
  }

  // 写出当前链顶的快照文件（供外部核验整链长度与 tip）。
  async writeCheckpoint(file) {
    const checkpoint = {
      exported_at: this.clock().toISOString?.() ?? new Date().toISOString(),
      count: this.entries.length,
      tip: this.tip,
    };
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, canonicalJSON(checkpoint), "utf8");
    return checkpoint;
  }
}

export async function readJsonl(path) {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}
