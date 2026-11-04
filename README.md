# opencode-historian

> 中文（本页） | [English →](README.en.md)

> OpenCode 插件：双语 wiki.js 知识库管理。

## 这是什么

opencode-historian 把 wiki.js 的读写、翻译、页型规范和迁移工具打包成 OpenCode 插件。

AI agent 装上它，就能直接管理双语知识库：写入的是结构化页面，回报的是双语链接。

## 为什么存在

这台机器由一个人加一群 AI agent 操作。会话一结束，细节就随滚动条消失；上下文一压缩，细节就丢了。

部署过什么、出过什么事故、踩过什么坑、做过什么决定——三个月后，人和 AI 都查无可查。

史官只做一件事：让这台机器的历史变得可以查。

它的写作规则不是发明的，蒸馏自五种语言的 wiki 工程传统，加上 SRE 的复盘文化。

五种传统各取一句：

- 中文：结论先行，序言不可侵犯；行动项必须带负责人和验证方式。
- 英文：Diátaxis 四象限；参考页要像地图一样镜像系统结构。
- 德文：先定义再展开，一页一概念；宁要格式错的引注，不要没有引注。
- 法文：溢美词必须改成事实；明天就过时的内容不写。
- 俄文：导言要好读，术语要少；篇幅按影响力分配，禁止虚假平衡。

调研全文见 `docs/research/cross-cultural-wiki-writing-digest.md`，每条主张附原文引用。

## 它能干什么

- 11 个 `historian_*` 工具：创建、更新、追加、阅读、搜索、删除、移动。
- 另有地图、时间线、维护报告、迁移、翻译片段、锚印封存。
- 页型契约：G1–G6 六种页型，各有固定骨架，见下方表格。
- 双语孪生：en 和 zh 页面自动翻译，翻译引擎由你配置。
- 每个写操作强制回报 en 与 zh 两个可访问 URL。
- 地图与时间线：双语缺口、迁移变化，一条命令可枚举。
- 维护报告：近似重复标题、过期页面、孤儿候选，一次扫清。
- 迁移门禁：存量页按骨架重排，先试评，后落笔。
- 口述留痕：`/historian-capture` 把当前会话总结成事件页。

## 快速上手

三步开始：

1. 在 `opencode.jsonc` 的 `plugin` 数组里加上包名。
2. 配置 wiki 地址和 API key 文件路径。
3. 对 agent 说人话，例如：「service-a 今天 OOM 重启，根因是缓存没上限，记下来」。

史官会分诊、选页型、过自检、写入 wiki，然后回报两个 URL。

最小配置：

```jsonc
["opencode-wiki-historian", {
  "baseUrl": "http://<your-wiki>:3000",
  "apiKeyPath": "~/.wiki-key"
}]
```

翻译腿可以不配。不配时双语孪生降级为 pending，不发任何网络请求。

## 安装

两种装法，都经过实测。

**方式一：npm 包（推荐）。** 在 `opencode.json[c]` 的 `plugin` 数组添加：

```jsonc
{ "plugin": ["opencode-wiki-historian"] }
```

注意 npm 包名是 `opencode-wiki-historian`，仓库名是 `opencode-historian`，两者不同。

**方式二：本地路径（开发用）。** 指向本地检出目录：

```jsonc
{ "plugin": ["file:///home/<you>/workspace/opencode-historian"] }
```

改完即生效，适合调试。

**装完验证**：跑一条 `opencode run --command historian --message "historian_map show"`。工具列表出现 11 个 `historian_*`，即安装成功。

**从 v2 升级**：先把旧的扁平 skill 文件改名停用，否则两个同名 skill 会冲突。对照表见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 配置

完整示例：

```jsonc
["opencode-wiki-historian", {
  "baseUrl": "http://<your-wiki>:3000",
  "apiKeyPath": "~/.wiki-key",
  "translate": {
    "endpoint": "https://<your-gateway>/v1",
    "model": "<your-model>",
    "apiKey": "<YOUR_KEY>"
  },
  "sections": ["team-notes/"],
  "locales": ["en", "zh"]
}]
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://localhost:3000` | wiki.js 地址 |
| `apiKeyPath` | `~/.wikijs-api-key` | wiki API key 文件 |
| `translate.endpoint` | 未配置 | 翻译 API 地址 |
| `translate.model` | 未配置 | 未配置时首次调用即报错 |
| `translate.apiKey` | 未配置 | 三种给法，见下 |
| `translate.providerKey` | 未配置 | 从 opencode 配置兜底读 key |
| `sections` | `[]`（不限制） | 可写路径前缀白名单 |
| `locales` | `["en","zh"]` | 启用的语言 |
| `readingLoop` | `false` | 开工前置「先查 wiki」提示 |
| `capture.enabled` | `false` | 空闲时提醒留痕，只提醒 |

翻译 key 三种给法，先到先用：配置字段、环境变量、opencode 的 provider 兜底。

`sections` 非空即强制生效：越界写入在发出请求前被拒，并点名越界的首段。

密钥链、降级细节与豁免路径清单，见 [DEVELOPMENT.md](DEVELOPMENT.md)。

**开工前置回路**（`readingLoop`）是双确认开关。配置打开，还要人工写一个哨兵文件：

```bash
cat > ~/.config/opencode/historian-reading-loop.json <<'EOF'
{"version":1,"confirmed":true}
EOF
```

两个信号缺一不可。配置已开而哨兵缺失时，加载期会打印提示，不会静默失灵。删除哨兵文件即刻回退。

## 前置要求（wiki.js 侧）

插件不替你执行任何管理端操作。安装前请确认：

- 多语言：启用 namespacing，Active Namespaces 包含 `en` 和 `zh`。
- API token：在 Admin > API Access 创建，覆盖页面的读、写、删除。
- token 内容写入 `apiKeyPath` 文件，或设为环境变量 `WIKIJS_API_KEY`。
- 组的页面规则要覆盖 `sections` 声明的路径前缀。
- 建议关闭评论功能，知识库页面不该被评论干扰。

## 中文页面在哪看

URL 规则：中文页在路径前加 `/zh/`，英文页不带前缀。

例如 `ops/deploy-checklist` 的中文版是 `/zh/ops/deploy-checklist`。

每个写操作的返回值自带 en 与 zh 两条 URL，直接点开即可。

看不到语言切换器时，检查 namespacing 与 zh 命名空间是否启用。

## 六种页型与索引层

| 页型 | 回答的问题 | 骨架一句话 |
|---|---|---|
| G1 事件复盘 | 发生过什么 | 时间线→根因→影响→行动项 |
| G2 对比选型 | 该选哪个 | 来源声明+对比表+结论 |
| G3 清单索引 | 从哪读起 | 可勾选的检查项 |
| G4 概念原理 | 它是什么、为何 | 定义→图示→示例 |
| G5 现状账本 | 现在跑着什么 | 每行带「上次核实于」 |
| G6 操作手册 | 怎么把事做完 | 每步：动作+预期+失败处置 |

索引层不算页型：`wiki-index` 是人策展的目录，配合地图与时间线视图。

每次写入后过 10 项自检门：句子要短、枚举进表格、时间线带来源列、双语 URL 必回报。

自检门全表与 20 条写作细则，见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 内容三层

| 层 | 位置 | 用途 |
|---|---|---|
| 人读页 | 主题章节 | 提炼后的内容，双语孪生，进索引 |
| 后台 | `_meta/` 加本地镜像 | 机器记账，不进人读正文 |
| 证据页 | `_evidence/` | 日志、转写等原始件；匿名不可读 |

人读页贴入超长代码块时，工具会附一条「建议搬到证据页」的提醒。只提醒，不拦截。

## 已知限制

| 事实 | 定性 |
|---|---|
| 翻译 key 全缺时，翻译相关工具整体禁用 | 按设计；补齐配置即恢复；部分降级在议 |
| 自进化驱动默认关，作者本机也尚未点亮 | 状态如实；代码与测试就绪，但文档不假装它在跑 |
| npm 包名与仓库名不同 | `opencode-historian` 已被无关同名包占用 |

## 与任何机器解耦

- 包内不携带真实主机、真实章节分类或页面数据。
- `sections` 默认不限制；实际写权限由你 wiki token 的页面规则决定。
- 翻译地址零内置：不配置就降级 pending，绝不发网络请求。
- 发布前每个随包文件过隐私红线扫描，命中即拦下发布。
- 示例全部占位符化：`http://<your-wiki>:3000`、`team-notes/`。

## 源码与许可证

公开分发渠道是 npm（包名 `opencode-wiki-historian`）。许可证 MIT。

开发、内部机制、发布流程、v2 迁移对照：全部在 [DEVELOPMENT.md](DEVELOPMENT.md)。
