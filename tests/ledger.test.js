import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { Ledger } from "../src/ledger.js";

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "hexb-ledger-"));
  return new Ledger(join(dir, "ledger.jsonl"), () => new Date("2026-10-01T00:00:00Z"));
};

test("追加事件形成哈希链，重载后可复验", async () => {
  const ledger = await fresh().load();
  await ledger.append("KNOWLEDGE_REGISTERED", "u1", { note: "a" });
  await ledger.append("PERMISSION_GRANTED", "u1", { note: "b" });
  const r1 = await ledger.verify();
  assert.equal(r1.ok, true);
  assert.equal(r1.count, 2);

  const ledger2 = await new Ledger(ledger.path, ledger.clock).load();
  const r2 = await ledger2.verify();
  assert.equal(r2.ok, true);
  assert.equal(r2.tip, r1.tip);
  assert.equal(ledger2.events().length, 2);
});

test("篡改任一行即被发现", async () => {
  const ledger = await fresh().load();
  await ledger.append("KNOWLEDGE_REGISTERED", "u1", { note: "a" });
  const fs = await import("node:fs");
  const line = fs.readFileSync(ledger.path, "utf8").trimEnd();
  const record = JSON.parse(line);
  record.event.payload.note = "tampered";
  // 仅改事件内容、保留旧 hash：哈希不符
  fs.writeFileSync(ledger.path, JSON.stringify(record) + "\n");
  const ledger2 = await new Ledger(ledger.path, ledger.clock).load();
  const r = await ledger2.verify();
  assert.equal(r.ok, false);
  assert.match(r.error, /哈希不符/);
});

test("重复 event_id 被拒绝", async () => {
  const ledger = await fresh().load();
  await ledger.append("KNOWLEDGE_REGISTERED", "u1", { note: "a" }, { eventId: "dup-1" });
  await assert.rejects(
    () => ledger.append("PERMISSION_GRANTED", "u1", { note: "b" }, { eventId: "dup-1" }),
    /事件重复/,
  );
});

test("非法事件种类不能入链", async () => {
  const ledger = await fresh().load();
  await assert.rejects(() => ledger.append("NOT_A_KIND", "u1", {}), /非法事件/);
});
