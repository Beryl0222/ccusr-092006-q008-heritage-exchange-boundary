import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJSON,
  generateSigningKeyPair,
  hashCanonical,
  sha256Hex,
  signCanonical,
  verifyCanonical,
} from "../src/crypto.js";

test("规范化 JSON：键序不影响哈希", async () => {
  const a = { b: 1, a: { z: 2, y: 3 }, c: [3, 1, 2] };
  const b = { c: [3, 1, 2], a: { y: 3, z: 2 }, b: 1 };
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  assert.equal(await hashCanonical(a), await hashCanonical(b));
  // 数组顺序是有意义的
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
});

test("sha256 稳定且为 64 位十六进制", async () => {
  assert.match(await sha256Hex("abc"), /^[0-9a-f]{64}$/);
  assert.equal(await sha256Hex("abc"), await sha256Hex(Buffer.from("abc")));
});

test("Ed25519 签名可验证，篡改文档即失效", async () => {
  const keys = await generateSigningKeyPair();
  const doc = { grant_id: "g1", expires_at: "2027-01-01" };
  const sig = await signCanonical(keys, doc);
  assert.equal(await verifyCanonical(keys.public_key, doc, sig), true);
  assert.equal(await verifyCanonical(keys.public_key, { ...doc, expires_at: "2099-01-01" }, sig), false);
  assert.equal(await verifyCanonical(keys.public_key, doc, sig.replace(/.$/, sig.endsWith("A") ? "B" : "A")), false);
});

test("他方公钥无法通过验证", async () => {
  const k1 = await generateSigningKeyPair();
  const k2 = await generateSigningKeyPair();
  const doc = { x: 1 };
  const sig = await signCanonical(k1, doc);
  assert.equal(await verifyCanonical(k2.public_key, doc, sig), false);
});
