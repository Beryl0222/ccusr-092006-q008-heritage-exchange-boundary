// HTTP 适配层：把 BoundaryService 暴露为 JSON API。
// 不含任何外部依赖，node src/server.js 即可启动。

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BoundaryService } from "./service.js";
import { Ledger } from "./ledger.js";
import { generateSigningKeyPair } from "./crypto.js";

// 从数据目录加载账本与签发密钥；密钥首次运行时生成（私钥文件不外传）。
export async function loadService(dataDir, { clock, issuerId } = {}) {
  await mkdir(dataDir, { recursive: true });
  const ledgerPath = join(dataDir, "ledger.jsonl");
  const keyPath = join(dataDir, "issuer.keys.json");

  const ledger = await new Ledger(ledgerPath, clock).load();
  let keySet;
  try {
    keySet = JSON.parse(await readFile(keyPath, "utf8"));
  } catch {
    keySet = await generateSigningKeyPair();
    await writeFile(keyPath, JSON.stringify(keySet, null, 2), { encoding: "utf8", mode: 0o600 });
  }
  return BoundaryService.create({ ledger, keySet, clock, issuerId });
}

const json = (res, status, body) => {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 4_000_000) reject(new Error("请求体过大"));
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${e.message}`));
      }
    });
    req.on("error", reject);
  });

export function createBoundaryServer(service) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const segs = url.pathname.split("/").filter(Boolean);
    const route = `${req.method} ${segs.join("/")}`;
    try {
      const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : {};

      switch (true) {
        case route === "GET status":
          return json(res, 200, await service.status());

        case route === "GET ledger/verify":
          return json(res, 200, await service.verifyLedger());

        case route === "POST units": {
          const v = await service.registerUnit(body);
          return json(res, 201, v);
        }
        case /^GET units\/[^/]+$/.test(route): {
          const unit = service.getUnit(segs[1]);
          return unit ? json(res, 200, unit) : json(res, 404, { error: "未找到知识单元" });
        }
        case /^POST units\/[^/]+\/updates$/.test(route): {
          const v = await service.updateUnit(segs[1], body);
          return json(res, 201, v);
        }
        case /^GET units\/[^/]+\/lineage$/.test(route): {
          const v = service.lineageOf(segs[1]);
          return v ? json(res, 200, v) : json(res, 404, { error: "未找到知识单元" });
        }
        case /^GET units\/[^/]+\/appearances$/.test(route):
          return json(res, 200, service.appearancesOf(segs[1], { media: url.searchParams.get("media") }));

        case route === "POST grants": {
          const g = await service.grantPermission(body);
          return json(res, 201, g);
        }
        case /^POST grants\/[^/]+\/withdraw$/.test(route):
          return json(res, 200, await service.withdrawPermission({ grant_id: segs[1], ...body }));

        case route === "POST derivations":
          return json(res, 201, await service.recordDerivation(body));
        case /^POST derivations\/[^/]+\/review$/.test(route):
          return json(res, 200, await service.reviewDerivation({ derivation_id: segs[1], ...body }));

        case route === "POST programs":
          return json(res, 201, await service.composeProgram(body));
        case /^POST programs\/[^/]+\/evaluate$/.test(route):
          return json(res, 200, service.evaluate(segs[1], body));

        case route === "POST packages": {
          const issued = await service.issuePackage(body);
          return json(res, 201, issued);
        }
        case /^GET packages\/[^/]+\/[^/]+$/.test(route): {
          const pkg = service.getPackage(segs[1], decodeURIComponent(segs[2]));
          return pkg ? json(res, 200, pkg) : json(res, 404, { error: "包不存在" });
        }
        case /^POST packages\/[^/]+\/revoke$/.test(route):
          return json(res, 200, await service.revokePackage({ package_id: segs[1], ...body }));
        case route === "GET revocation-list":
          return json(res, 200, await service.revocationList());
        case route === "POST packages/verify":
          return json(res, 200, await service.verifyOffline(body.bundle, { revocation: body.revocation ?? null, ctx: body.ctx ?? {} }));

        case route === "POST shows":
          return json(res, 201, await service.completeShow(body));

        case route === "POST docent/answer":
          return json(res, 200, await service.docentAnswer(body));

        case route === "POST disputes":
          return json(res, 201, await service.recordDispute(body));
        case /^POST disputes\/[^/]+\/substitutes$/.test(route):
          return json(res, 200, await service.linkSubstitute({ dispute_id: segs[1], ...body }));
        case /^POST disputes\/[^/]+\/resolve$/.test(route):
          return json(res, 200, await service.resolveDispute({ dispute_id: segs[1], ...body }));
        case route === "GET disputes":
          return json(res, 200, service.listDisputes());

        default:
          return json(res, 404, { error: `未知路由: ${route}` });
      }
    } catch (err) {
      const status = err.code === "LICENSE_DENIED" ? 403 : 400;
      return json(res, status, {
        error: err.message,
        code: err.code ?? null,
        decision: err.decision ?? undefined,
      });
    }
  });
}

// 直接运行：node src/server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), ".data");
  const port = Number(process.env.PORT ?? 8080);
  const service = await loadService(dataDir);
  const server = createBoundaryServer(service);
  server.listen(port, () => {
    console.log(`非遗跨境展演知识边界服务已启动: http://localhost:${port}（数据目录 ${dataDir}）`);
  });
}
