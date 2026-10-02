// 加密基础：规范化 JSON、内容哈希、Ed25519 签名与验签。
//
// 离线包与撤销名单需要在无网络环境下仍可验证，因此只使用 Node 内置
// webcrypto（Ed25519），不引入外部依赖。签名只证明“签发方在某时刻
// 出具了这份内容”，不改变许可本身。

import { webcrypto as crypto } from "node:crypto";

const SUBTLE = crypto.subtle;

// 对象键按字典序递归排序，保证同一语义的文档字节一致、哈希可复验。
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

export function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const data = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  const digest = await SUBTLE.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}

export async function hashCanonical(value) {
  return sha256Hex(canonicalJSON(value));
}

// 生成签发方密钥对（项目办公室离线签发身份）。返回可存档的 JSON。
export async function generateSigningKeyPair() {
  const pair = await SUBTLE.generateKey("Ed25519", true, ["sign", "verify"]);
  const [pk, sk] = await Promise.all([
    SUBTLE.exportKey("spki", pair.publicKey),
    SUBTLE.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    alg: "Ed25519",
    public_key: Buffer.from(pk).toString("base64url"),
    private_key: Buffer.from(sk).toString("base64url"),
  };
}

async function importPrivate(keySet) {
  return SUBTLE.importKey(
    "pkcs8",
    Buffer.from(keySet.private_key, "base64url"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

async function importPublic(publicKeyBase64Url) {
  return SUBTLE.importKey(
    "spki",
    Buffer.from(publicKeyBase64Url, "base64url"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

// 对“规范化后的文档”签名，返回 detached 签名（base64url）。
export async function signCanonical(keySet, document) {
  const key = await importPrivate(keySet);
  const sig = await SUBTLE.sign("Ed25519", key, Buffer.from(canonicalJSON(document), "utf8"));
  return Buffer.from(sig).toString("base64url");
}

export async function verifyCanonical(publicKeyBase64Url, document, signature) {
  try {
    const key = await importPublic(publicKeyBase64Url);
    return await SUBTLE.verify(
      "Ed25519",
      key,
      Buffer.from(signature, "base64url"),
      Buffer.from(canonicalJSON(document), "utf8"),
    );
  } catch {
    return false;
  }
}
