# 非遗跨境展演知识边界服务

把面塑、茶艺、民族纹样等非遗跨境展演涉及的**技艺、故事、影像、译文、互动环节**拆成可独立管理的
知识单元，逐项注明**来源共同体、可公开地域、受众年龄、署名、录制、商业用途和到期日**；节目引用其中
任何一项，都必须由**同一张许可同时覆盖全部维度**，且节目对所有引用项做逻辑与。翻译或剪辑一旦被复核
认定改变含义，原许可确认不再沿用。

所有动作进入一条**哈希链账本（只增不改）**；离线材料包带 **Ed25519 签名、逐项 SHA-256 与到期信息**，
在无网络环境也能自证版本并自动失效；讲解员面对临时提问只能在获准范围内作答。许可撤回不溯及已依法
完成的场次，但后续下载与复用必须停止；争议与替代素材持续留痕；传承人可直接看到某段知识在哪座城市、
哪次活动、哪种媒介出现过。

> 仓库内全部为虚构资料，不含真实个人信息、生产连接或外部账号；零第三方依赖，仅使用 Node 内置能力
> （需 Node ≥ 20，开发环境为 Node 22）。

## 为什么需要它

事故场景：海外学校在巡演前索要双语讲义与演示视频，材料被打成同一个下载包，传承人在上传后才发现——
*内部口传、祭仪含义、可商业复刻图样*和公开内容被一起发了出去。本服务用三层结构消除该事故：

1. **单元 × 切面 × 密级**：一个单元内部再分切面（公开手法 / 内部口传 / 祭仪含义 / 神圣母题 /
   可商业复刻图样…），授权精确到切面，敏感内容无法搭公开内容的便车。
2. **节目交集闸门**：引用任意一项即要求该项全部许可通过；打包、开场、问答前都走同一判定。
3. **离线自证与撤回**：签发的包自带签名、哈希、到期日；撤销名单随包或联网更新，命中即失效。

## 快速开始

```bash
npm test          # 19 项规则测试（加密/账本/许可/派生/撤回/包/问答/溯源）
npm run demo      # 面塑·茶艺·纹样三共同体的端到端剧本（12 个场景，含断言）
npm start         # 启动 HTTP 服务，默认 http://localhost:8080，数据目录 .data/
DATA_DIR=/var/lib/hexb PORT=8080 npm start
```

首次启动会在数据目录生成 `issuer.keys.json`（Ed25519 签发密钥，权限 0600）。**私钥必须由项目办公室
离线保管**；离线核验方只需要其中的 `public_key`。

## 核心模型

### 知识单元与切面

| 字段 | 含义 |
| --- | --- |
| `unit_id` / `version` | 单元标识与版本；更新走新版本（`KNOWLEDGE_UPDATED`），旧版不删 |
| `kind` | `TECHNIQUE` 技艺 / `STORY` 故事 / `IMAGE` 影像 / `TRANSLATION` 译文 / `INTERACTION` 互动 |
| `sensitivity` | `PUBLIC` / `RESTRICTED`（内部口传）/ `SACRED`（祭仪、神圣母题） |
| `aspects[]` | 知识切面，如 `PUBLIC_TECHNIQUE`、`INTERNAL_ORAL`、`RITUAL_MEANING`、`SACRED_MOTIF`、`COMMERCIAL_PATTERN`（见 `src/heritage_exchange_boundary.js`，允许共同体扩展） |
| `source_community` | 来源共同体 `{community_id, name, region}` |
| `custodian` | 传承人/守护者 |
| `body_hash` | 正本（讲义/视频）的 SHA-256；内容本身不进账本 |

### 许可确认（grant，七个维度 + 切面）

`territories`（可公开地域，ISO 码，`*` 为不限）、`min_age`（受众最低年龄）、`media`（媒介）、
`recording`（`ALLOWED`/`PROHIBITED`）、`commercial`（是否允许商业用途）、`attribution`（必须展示的署名）、
`valid_from`/`expires_at`（生效与到期），外加授权到的 `aspects[]` 与 `allow_derivations`（是否允许
翻译/剪辑派生）。每张许可必须由 `confirmer`（共同体确认人）出具。

**交集规则（`src/permissions.js`）**

- 一次使用的全部维度必须由**同一张**许可同时满足，不能用“甲许可给地域 + 乙许可给商业”拼凑；
- 节目对每个引用项、每个切面逐一判定，**任一失败则整档节目/包/场次不获准**；
- 只有现场确实在录制（`recording:true`）时才检查录制维度；未录制不触发。

### 翻译 / 剪辑派生链

`DERIVATION_RECORDED` 建立“子版本 → 父本”边，初始 `review_status=PENDING`、不继承许可。
共同体复核（`TRANSLATION_REVIEWED`）给出：

- `FAITHFUL`（保全原义）且父本许可 `allow_derivations=true` → 许可沿链继承；
- `MEANING_CHANGED`（改变含义）或未复核 → 继承链在此切断，子版本视为没有上游确认。

链可多级；评估时逐边向上解析，任一阻断边都会体现在 `blocking_edge`。

### 离线材料包与撤销名单（`src/package.js`）

`PACKAGE_ISSUED` 生成：

- `manifest`：逐项 `{ref, 切面, 密级, 署名, 权威链, 逐切面许可快照}` 与 `contents{逻辑路径: sha256}`；
- 包级 `expires_at` = 各项命中许可的**最早到期日**；
- `manifest_version_hash`：清单规范化 JSON 的 SHA-256，双方可口头核对“版本号”；
- Ed25519  detached `signature`。

离线核验 `POST /packages/verify`（或 `verifyPackage`）按顺序检查：
①清单签名 → ②逐项内容哈希（缺失/替换即失败）→ ③包级到期 → ④撤销名单（自身先验签；整包撤销或
任一许可撤回即命中）→ ⑤按**本次实际场景**（地域/年龄/媒介/录制/商业/时间）复核每切面许可。
返回状态：`VALID` / `UNTRUSTED` / `EXPIRED` / `REVOKED` / `DENIED`。无撤销名单时仅受到期约束，
并明确提示“联网后必须补查”。

### 场次与祖父条款

`SHOW_COMPLETED` 在开场前做全维度评估，通过才记录，并锚定城市、时间、是否录制与所用许可。
撤回许可时（`PERMISSION_WITHDRAWN`）自动列出 `completed_at <= 撤回时刻` 且引用了该单元的已完成场次
（`preserves_completed_shows`）：**这些场次依法有效、不被否定**；撤回之后的任何下载、复用、新场次
一律拒绝，已签发的包通过撤销名单失效。

### 讲解员问答边界（`src/docent.js`）

讲解员不持有自由裁量。系统取该场次已获准节目的评估结果 + 讲解员角色被分派的切面（`role_aspects`）
+ 现场情境（城市/受众年龄/是否录制/是否商业拍摄），对提问做实时判定：

- 内容不在节目内、节目项未获准、角色未被分派该切面、该切面在当前情境未获准 → 拦截；
- 命中祭仪/内传/商用复刻等敏感词，或神圣母题遇录制/商业拍摄 → 拦截；
- 即便无敏感词，也必须存在至少一个“角色获准 × 本场获准”的切面才可作答；
- 拦截返回统一**安全话术**并转呈传承人；`ANSWER_GIVEN` / `ANSWER_GUARDED` 全部留痕，
  允许的回答同时写入出现记录（媒介 `LIVE_QA`）。

### 争议与替代素材

`DISPUTE_RECORDED`（默认 `hold_future_use:true`，争议期间暂停后续复用）→ `SUBSTITUTE_LINKED`
关联共同体批准的替代单元版本 → `DISPUTE_RESOLVED`（`UPHELD` 维持限制 / `RELEASED` 解除）。
全程为独立事件，删除不了，也不改动既有许可事件。

### 溯源视图（传承人视角）

每次签发下载包、完成场次、边界内问答都会写 `APPEARANCE_RECORDED`。
`GET /units/:id/appearances` 返回时间线与按“**城市 / 活动 / 媒介**”的聚合；
`GET /units/:id/lineage` 返回版本、密级、切面、各许可状态、派生复核结论与出现次数。

## HTTP 接口

| 方法与路径 | 作用 |
| --- | --- |
| `GET /status` `GET /ledger/verify` | 状态计数；哈希链完整性校验 |
| `POST /units` `GET /units/:id` `POST /units/:id/updates` | 登记 / 查询 / 升版 |
| `GET /units/:id/lineage` `GET /units/:id/appearances` | 谱系；城市/活动/媒介出现视图 |
| `POST /grants` `POST /grants/:id/withdraw` | 许可确认；撤回（含祖父条款清单） |
| `POST /derivations` `POST /derivations/:id/review` | 翻译/剪辑登记；含义复核 |
| `POST /programs` `POST /programs/:id/evaluate` | 节目组合；按情境做交集评估 |
| `POST /packages` | 评估通过才签发离线包（可带 `files` 计算逐项哈希） |
| `GET /packages/:id/:version` `POST /packages/:id/revoke` | 取包；整包撤销 |
| `GET /revocation-list` `POST /packages/verify` | 签名撤销名单；离线核验 |
| `POST /shows` | 记一场依法完成的场次 |
| `POST /docent/answer` | 讲解员问答判定与留痕 |
| `POST /disputes` `GET /disputes` | 争议登记/列表 |
| `POST /disputes/:id/substitutes` `POST /disputes/:id/resolve` | 替代素材；了结 |

请求/响应字段以 `examples/demo.mjs` 与 `tests/` 为准。许可不满足时返回 `403` 与完整逐项 `decision`。

### 最小调用示例

```bash
curl -X POST localhost:8080/units -H 'content-type: application/json' -d '{
  "unit_id":"dough","kind":"TECHNIQUE","title":"面塑公开手法",
  "sensitivity":"RESTRICTED","aspects":["PUBLIC_TECHNIQUE"],
  "source_community":{"community_id":"C-MT","name":"晋南面塑共同体","region":"CN-SX"},
  "custodian":{"custodian_id":"p-wang","name":"王师傅","role":"传承人"}
}'

curl -X POST localhost:8080/grants -H 'content-type: application/json' -d '{
  "grant_id":"g-dough-us","unit_id":"dough",
  "territories":["US"],"min_age":6,"media":["LIVE","DOWNLOAD"],
  "recording":"ALLOWED","commercial":false,"aspects":["PUBLIC_TECHNIQUE"],
  "attribution":"面塑技艺 © 晋南面塑共同体·王师傅","expires_at":"2027-06-30T23:59:59Z",
  "confirmer":{"custodian_id":"p-wang","name":"王师傅","community_id":"C-MT"}
}'

curl -X POST localhost:8080/packages -H 'content-type: application/json' -d '{
  "package_id":"pkg-us","refs":[{"unit_id":"dough","version":"1.0"}],
  "recipient":{"school":"SF School","city":"San Francisco","country":"US","territory_code":"US"}
}'
```

## 代码结构

```
src/
  heritage_exchange_boundary.js  领域词表（单元/密级/切面/媒介/事件）与事件校验
  crypto.js                      规范化 JSON、SHA-256、Ed25519 签名/验签
  ledger.js                      只增哈希链账本（JSONL）与完整性校验
  store.js                       事件回放的只读查询模型 + 登记校验
  permissions.js                 单许可/单元/派生链/节目交集评估（纯函数）
  package.js                     清单、签名、撤销名单、离线核验
  docent.js                      讲解员问答边界与安全话术
  service.js                     BoundaryService 门面（以账本为唯一事实来源）
  server.js                      node:http JSON API
examples/demo.mjs                三共同体端到端剧本
tests/                           node:test（19 项）
data/sample.json                 虚构事件样例
```

## 运维与边界说明

- **账本即事实来源**：`ledger.jsonl` 只增，每行含 `seq/prev_hash/hash`；任何改写都会被
  `GET /ledger/verify` 发现。撤回、争议通过追加新事件表达，不要手工改历史行。
- **签名只证明出处与完整性**，不替代共同体的真实授权流程；许可确认人身份、口头同意的证据等需在
  组织流程中留存，本系统记录其声明与时间戳。
- **撤销的时效性**：离线设备只有在拿到较新撤销名单后才能感知撤回；应在每次联网/开场前强制更新，
  并对无法更新撤销名单的复用按高风险处理。到期失效则不依赖网络。
- 地域码、年龄阈值、敏感词词表（`src/docent.js`）应由各来源共同体提供并版本化，默认词表仅为演示。
- 本服务不含鉴权/多租户/真实文件存储：`body_hash` 只锚定正本指纹，讲义与视频的存放与传输需另行建设，
  并在签发时通过 `files` 注入字节以锁定逐项哈希。
```
