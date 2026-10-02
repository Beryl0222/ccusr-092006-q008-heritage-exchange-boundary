// 离线材料包：签名清单、逐项哈希、自动失效与撤销名单。
//
// 离线侧（海外学校的电脑、讲解员平板）不连接本服务时，仍能凭三件套
// 完成核验：① 清单上的 Ed25519 签名；② 逐项内容哈希；③ 随包附带或
// 事后下发的撤销名单。到期或命中撤销即“自动失效”，不需要联网开关。

import { canonicalJSON, hashCanonical, sha256Hex, signCanonical, verifyCanonical } from "./crypto.js";
import { checkGrant } from "./permissions.js";

export const PACKAGE_SPEC_VERSION = "1.0";

// 依据节目评估结果构造包清单。items 来自 evaluateProgram（必须全部获准）。
// item.terms_by_aspect 由服务注入：{切面: 命中许可的完整快照}。
// files 为 { [`${unit_id}@${version}`]: 字节 } 的实际随包内容（可选）。
export async function buildManifest({ package_id, package_version, name, recipient, items, files = {}, issued_at, expires_at, issuer_id }) {
  const contents = {};
  const manifests = items.map((item) => {
    const termsByAspect = item.terms_by_aspect ?? {};
    const grantIds = [...new Set(Object.values(termsByAspect).map((g) => g.grant_id))];
    const allMedia = [...new Set(Object.values(termsByAspect).flatMap((g) => g.media ?? []))];
    return {
      ref: item.ref,
      title: item.title,
      source_community: item.source_community ?? null,
      sensitivity: item.sensitivity,
      aspects: item.decisions.map((d) => d.aspect),
      body_hash: item.body_hash ?? null, // 随包实际字节的哈希
      source_body_hash: item.source_body_hash ?? null, // 单元登记时记录的正本哈希
      required_attribution: [...new Set(item.decisions.map((d) => d.required_attribution).filter(Boolean))],
      authority_chain: item.authority_chain ?? [],
      terms_grant_ids: grantIds,
      terms_by_aspect: termsByAspect,
      all_media: allMedia,
    };
  });

  for (const m of manifests) {
    const path = `contents/${m.ref.unit_id}@${m.ref.version}/${m.aspects.join("_")}.json`;
    const key = `${m.ref.unit_id}@${m.ref.version}`;
    const bytes = files[key];
    contents[path] = {
      sha256: bytes ? await sha256Hex(bytes) : (m.body_hash ?? "pending"),
      media_terms: m.all_media,
    };
  }

  return {
    spec_version: PACKAGE_SPEC_VERSION,
    package_id,
    package_version,
    name,
    issuer_id,
    issued_at,
    // 包级到期日取各项许可最早到期；无到期许可时为 null（长期有效但仍受撤销约束）。
    expires_at: expires_at ?? null,
    recipient, // { school, city, country, territory_code }
    items: manifests,
    contents,
  };
}

// 计算清单自身的可验证版本号（哈希前缀），便于双方口头核对。
export function manifestVersionHash(manifest) {
  return hashCanonical(manifest);
}

export async function signManifest(keySet, manifest) {
  return signCanonical(keySet, manifest);
}

// 构造撤销名单（带单调版本号与签名）。离线侧拿到较新版本即替换旧版。
export async function buildRevocationList({ version, withdrawnGrants, revokedPackages, generated_at, keySet, issuer_id }) {
  const doc = {
    kind: "REVOCATION_LIST",
    spec_version: PACKAGE_SPEC_VERSION,
    issuer_id,
    version,
    generated_at,
    grants: withdrawnGrants.map((g) => ({ grant_id: g.grant_id, withdrawn_at: g.withdrawn_at, reason: g.reason ?? "" })),
    packages: revokedPackages, // [{package_id, package_version, reason, at}]
  };
  return { doc, signature: await signCanonical(keySet, doc) };
}

// 离线核验：不依赖服务端任何状态。
// bundle: { manifest, signature, files? }，files 为 {逻辑路径: 字节(字符串/Buffer)}
// revocation: { doc, signature } | null
export async function verifyPackage(bundle, { publicKey, revocation = null, ctx = {} }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const now = ctx.at ? new Date(ctx.at) : new Date();

  // 1. 签名
  const sigOk = await verifyCanonical(publicKey, bundle.manifest, bundle.signature);
  add("manifest_signature", sigOk, sigOk ? "清单签名有效" : "清单签名无效，整包不可信");

  // 2. 清单版本与内容逐项哈希（防止夹带或替换讲义/视频）
  let hashOk = true;
  if (bundle.files) {
    for (const [path, meta] of Object.entries(bundle.manifest.contents)) {
      if (!(path in bundle.files)) {
        hashOk = false;
        add(`content_present:${path}`, false, "清单列出的内容缺失");
        continue;
      }
      const h = await sha256Hex(bundle.files[path]);
      const present = h === meta.sha256;
      if (!present) hashOk = false;
      add(`content_hash:${path}`, present, present ? "内容哈希一致" : "内容被改动或与清单不符");
    }
  } else {
    add("content_hash", true, "未提供文件字节，仅核验清单与许可");
  }

  // 3. 包级到期
  let expiryOk = true;
  if (bundle.manifest.expires_at && now > new Date(bundle.manifest.expires_at)) {
    expiryOk = false;
    add("package_expiry", false, `材料包已于 ${bundle.manifest.expires_at} 自动失效`);
  } else {
    add("package_expiry", true, bundle.manifest.expires_at ? `有效至 ${bundle.manifest.expires_at}` : "无固定到期日");
  }

  // 4. 撤销名单自身有效，且其中不含本包或本包依赖的许可
  let revocationOk = true;
  if (revocation) {
    const rlSig = await verifyCanonical(publicKey, revocation.doc, revocation.signature);
    add("revocation_list_signature", rlSig, rlSig ? "撤销名单签名有效" : "撤销名单签名无效，拒绝采信");
    if (rlSig) {
      const pkgHit = revocation.doc.packages?.find(
        (p) =>
          p.package_id === bundle.manifest.package_id &&
          (p.package_version === "*" || String(p.package_version) === String(bundle.manifest.package_version)),
      );
      if (pkgHit) {
        revocationOk = false;
        add("package_revoked", false, `整包已撤销：${pkgHit.reason}（${pkgHit.at}）`);
      }
      for (const item of bundle.manifest.items) {
        for (const gid of item.terms_grant_ids ?? []) {
          const hit = revocation.doc.grants?.find((g) => g.grant_id === gid);
          if (hit) {
            revocationOk = false;
            add(`grant_revoked:${gid}`, false, `许可撤回（${hit.withdrawn_at}）：${hit.reason}`);
          }
        }
      }
      const anyHit = bundle.manifest.items.some((i) =>
        (i.terms_grant_ids ?? []).some((gid) => revocation.doc.grants?.some((g) => g.grant_id === gid)),
      );
      if (!pkgHit && !anyHit) {
        add("revocation_lookup", true, `未命中撤销名单 v${revocation.doc.version}`);
      }
    } else {
      revocationOk = false;
    }
  } else {
    add("revocation_lookup", true, "无撤销名单（离线默认仅受到期约束；联网后必须补查）");
  }

  // 5. 本次具体复用场景对逐项许可做全维度复核（地域/年龄/媒介/录制/商业/时间）
  let termsOk = true;
  for (const item of bundle.manifest.items) {
    for (const aspect of item.aspects) {
      const terms = item.terms_by_aspect?.[aspect];
      if (!terms) {
        termsOk = false;
        add(`terms:${item.ref.unit_id}:${aspect}`, false, "缺少该切面的许可快照");
        continue;
      }
      const r = checkGrant(terms, aspect, ctx);
      if (!r.ok) {
        termsOk = false;
        add(`terms:${item.ref.unit_id}:${aspect}`, false, r.violations.map((v) => v.reason).join("；"));
      }
      if (terms.expires_at && now > new Date(terms.expires_at)) {
        termsOk = false;
        add(`terms_expiry:${item.ref.unit_id}:${aspect}`, false, `许可 ${terms.grant_id} 已到期`);
      }
    }
  }

  const valid = sigOk && hashOk && expiryOk && revocationOk && termsOk;
  return {
    valid,
    package_id: bundle.manifest.package_id,
    package_version: bundle.manifest.package_version,
    expires_at: bundle.manifest.expires_at,
    status: !sigOk ? "UNTRUSTED" : valid ? "VALID" : !expiryOk ? "EXPIRED" : !revocationOk ? "REVOKED" : "DENIED",
    checks,
    canonical_manifest: canonicalJSON(bundle.manifest),
  };
}
