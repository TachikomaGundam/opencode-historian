# 接入你自己的 wiki.js / Adapting Historian to Your Own Wiki

把史官插件搬到另一台机器、指向你自己的 Wiki.js 实例的六步自助上手指南。所有示例均为占位值（example.com / localhost / team-notes/ / 8000），不含任何真实部署。

Six-step self-onboarding for pointing the historian plugin at your own Wiki.js instance on another machine. Every value below is a placeholder.

## 1. 指向你的 wiki.js 实例 / Point at your instance

- `baseUrl` 选项：默认 `http://localhost:3000`，一般无需改。
- API token：在 wiki.js 管理端 Settings → API Tokens 生成读写 token。两种放置方式，读取优先级为**密钥文件在前、env 在后**：
  - `apiKeyPath` 指向的单行文件（默认 `~/.wikijs-api-key`，内容一行 token，读取时 trim）；
  - 或环境变量 `WIKIJS_API_KEY`。
- 配置写在 `opencode.jsonc` 的 `plugin` 二元组第二参数：

```jsonc
"plugin": [
  ["opencode-historian", { "baseUrl": "http://example.com:3000" }]
]
```

## 2. 章节白名单 / sections 白名单

- 选项 `sections` 默认空数组 = 插件端**不限制**路径前缀；真正的写权限由你的 wiki.js token 的 page rules 决定。
- v4 起非空即强制生效：`historian_page_create` / `page_update` / `page_append` / `delete` / `move`（检查 `newPath`）五个写工具在发出任何请求前过 `sectionGuard`（`src/tools/shared.ts`），越界路径直接返回 `ConfigError` 类错误信封，并点名越界的首段、提示把它加进 `sections`。
- 匹配语义：按**首路径段**、**区分大小写**地做段前缀匹配——`"sections": ["team-notes", "scratch"]` 授权 `team-notes` 与 `team-notes/x/y`，但不授权 `docs/x` 这类不同首段；配置项里的首尾斜杠可省（`"team-notes/"` 与 `"team-notes"` 等价）。
- 豁免表（恒可写，与 `sections` 配置无关）：`home`、`wiki-index`、`_sandbox`、`_data`、`_meta`、`_evidence`。理由：主题白名单管的是人读知识页的归处，插件自记账（索引缓存、机器命名空间）与落地页/沙箱不该被锁死。
- 不要复用别人的章节表；接入后先 `historian_map action=show` 看你自己的布局。

## 3. 翻译腿是可选项 / The translate leg is optional

- 发布包**不内置**任何翻译端点。解析链：`translate.endpoint` 选项 → 环境变量 `HISTORIAN_TRANSLATE_ENDPOINT` → 未配置。
- 翻译 key 链：`translate.apiKey` → `DASHSCOPE_API_KEY` → `translate.providerKey` 指定的本地 jsonc provider（三段都缺 = 翻译腿关闭）。
- 端点未配置时的行为：页面照常创建，zh 孪生页返回 `zh_status: 'pending'`；随后手工双语补全——创建/追加时直接给 `sectionZh` 参数，或配好翻译腿后用 `historian_translate_snippet` + `historian_page_update`。

## 4. 认清 wiki.js 的 9 个 API 陷阱 / Know the 9 pitfalls

`references/wikijs-guide.md` 汇总了 wiki.js 2.x 实测的 9 条 API 行为（搜索通配、locale 路径、孪生解析、assets 上传等）。史官工具已全部内化；若你绕过工具直接调 GraphQL，先读那一节。

## 5. 隐私红线与发布门 / Privacy red-lines & the pre-publish gate

- 任何进入包/文档的内容不得包含：真实主机名、真实用户路径（`/home/...`）、token、真实私有部署的页面标题与章节表。
- 硬门：`node tools/privacy-audit.mjs` 扫描 `npm pack` 全部文件（含 `dist/` 与 `skills/`）。改过任何随包文本后必须跑到 exit 0 再发布。

## 6. 机构记忆层开关与证据层 / reading-loop & capture switches, evidence tier

- `readingLoop` 开关默认关闭（false），true 需配置+哨兵双确认：插件向每次请求的 system 注入"先查 wiki"提示，但只有配置信号与本机哨兵文件同时到位才生效。注入是单块合并（追加到最后一个 system 块），绝不产生第二条 system 消息——严格 OpenAI 兼容后端（如 vLLM）同样安全。
- 哨兵文件必须由人在本机写入（agent 自我启用被禁止）：

  ```bash
  cat > ~/.config/opencode/historian-reading-loop.json <<'EOF'
  {"version":1,"confirmed":true}
  EOF
  ```

- 缺一不生效：只配了选项而没有哨兵，插件加载期打一条提示（给出哨兵路径与内容），不注入；删除哨兵文件即刻回退。
- `capture.enabled` 默认 `false`：置 `true` 后会话空闲时弹一条 toast 提醒；**只提醒、绝不自动写页**。`/historian-capture` 命令始终注册，与此开关无关。
- 证据层接入：会话产出的原始件（日志、转写、大 diff）超过 10 行时，用 `historian_page_create` 传 `tier: "evidence"` 存入 `_evidence/<主题>--<yyyymmdd>`（单语 en、不发布、匿名访问 404 属 by design），人读页附录只放决定性摘录加链接。往人读页写超过 30 行的围栏块会收到一条 `advisory` 软提醒，不阻断写入。

```jsonc
["opencode-historian", { "readingLoop": true, "capture": { "enabled": true } }]
```

---

配完六步，你的史官即就位：consult（reading loop 双信号启用后自动引路）、notice（capture 提醒留痕）、record（G1-G6 骨架 + `_evidence/` 证据页 + map/timeline/maintain 归档）。
