# 研途 · Kaoyan Agent Workbench

面向 2028 考研的个人 AI 学习工作台。它把任务、专注计时、GitHub 风格学习热力图、错题复习、院校情报、私有资料 RAG 与双 Agent 学习助手放在同一个可追踪的学习闭环中。

> 当前状态：`v1.5` 院校、资料与实习智能体已完成代码实现，`v1.4` 电子书与本地优先 RAG 已合并。登录、任务、专注计时、手动补录、双指标年度热力图、三级计划、完整错题管理、AI 多任务提案、私有电子书、账户隔离的设备缓存、院校/资料/求职分析入口、Embedding 混合检索、扫描 PDF OCR、来源引用、人工审批、幂等写入、审计日志、多轮对话恢复和 SSE 流式回答均已接通。

## 产品能力

- 年度学习热力图：默认按目标完成度显示，支持切换有效学习时长，并可按数学、英语、政治、408 和项目筛选。
- 今日工作台：任务创建与完成、可暂停专注计时、学习会话写入和在线状态提示。
- 快捷入口：顶部支持全局搜索、任务与错题快速记录，以及云端待处理事项汇总；搜索可用 `Ctrl/⌘ + K` 唤起并通过方向键与 Enter 操作。
- 页面导航：按账户记住最后访问的工作台页面，刷新或重新打开后继续上次位置，不同账户之间互不影响。
- 云端连接状态支持点击立即重试，后端重启或网络恢复后无需等待定时检查。
- 三级计划：阶段、周、日计划及计划偏差。
- 侧栏阶段目标从当前账户的云端阶段计划实时读取，并展示日期进度、加载、空数据与连接失败状态。
- 学科与错题：章节进度、薄弱点和复习安排。
- 院校情报：信息精确到学院、专业代码、招生年份和官方来源。
- 双 Agent：计划教练与资料导师使用 LangGraph 路由，读取真实个人上下文；写入操作只生成可编辑、可拒绝、可幂等批准的持久化提案。
- Agent 对话：支持主动开始新对话、查看最近对话并恢复历史消息；回答通过 SSE 逐段显示，新消息自动滚动且回答可一键复制，存在待审批提案时禁止误切换会话。
- 长请求保护：Agent 生成期间可以停止流式请求；未完整回答不会写入对话历史，提案仍遵守人工确认边界。
- 私有 RAG：PDF/Markdown 上传、文件哈希去重、按标题或页码切分、Embedding 与全文索引混合检索已经可用；模型不可用时自动保留关键词检索。
- 电子书与本地优先检索：登录用户可在浏览器内阅读私有 PDF/Markdown，并主动把安全原文片段缓存到当前浏览器；本地关键词命中时查询不会发送到云端，无本地缓存或无命中时才回退现有云端混合检索。
- 决策智能体：院校、资料库和求职页可把可编辑问题带入资料导师；只按问题加载必需的当前用户记录，院校按招生年份隔离，求职优先当前流程，回答保留院校档案、求职记录、个人资料或网页来源标识。
- 扫描资料：低文本密度 PDF 自动创建可重试 OCR 任务，独立 Worker 完成页面识别、安全检查、切分和向量化。
- 联网搜索：通过 Tavily 检索并展示可追溯来源，搜索历史按用户留痕；只有批准导入提案后才下载、解析、去重并永久入库。
- 安全边界：阻止内网 URL 导入、标记资料中的提示词注入、Agent 批准写入使用幂等键。

## 技术栈

- Web：React 19、TypeScript、Vite/Vinext、PWA
- API：FastAPI、Pydantic
- Data：Supabase Auth、PostgreSQL、Storage、pgvector、RLS
- AI：LangChain、LangGraph、OpenAI-compatible models、Tavily

详细设计见 [docs/architecture.md](docs/architecture.md)。

## 本地启动

### Web

```bash
npm install
npm run dev
```

不配置 Supabase 时会进入明确标记的离线演示模式。启用登录时：

```bash
cp .env.example .env.local
npm run dev
```

默认访问 `http://localhost:3000`。

### API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
uvicorn app.main:app --reload
```

安装一次后，也可以在项目根目录运行 `npm run dev:api`。

API 文档位于 `http://localhost:8000/docs`。`DEMO_MODE=true` 使用按用户隔离的进程内仓库，重启 API 后会清空；`DEMO_MODE=false` 使用 Supabase PostgreSQL，并由用户 JWT 和 RLS 双重限制数据范围。未配置外部密钥时不会产生模型或联网搜索调用。

前端会自动连接 `http://localhost:8000`。未配置 Supabase 时页面保留演示数据；配置后必须先使用邮箱和密码登录，请求会自动携带可刷新访问令牌。

### v0.8+ AI 与 OCR 配置

聊天、向量和 OCR 通过独立的 OpenAI 兼容配置接入，当前固定分工是：

- Agent 聊天：DeepSeek Flash/Pro，失败时按相同档位切换到 Qwen；
- 私有资料向量：阿里云百炼 `text-embedding-v4`；
- 扫描 PDF OCR：阿里云百炼 `qwen3.5-ocr`。

在 `backend/.env` 中填写（密钥只放本地真实 `.env`，不要写进 `.env.example` 或提交到 Git）：

```dotenv
# 旧版统一配置留空；仅使用同一家服务时才需要填写。
OPENAI_API_KEY=
OPENAI_BASE_URL=

CHAT_PROVIDER=deepseek
CHAT_DEFAULT_PROFILE=flash
CHAT_API_KEY=<DeepSeek API Key>
CHAT_BASE_URL=https://api.deepseek.com
CHAT_FLASH_MODEL=deepseek-v4-flash
CHAT_PRO_MODEL=deepseek-v4-pro

CHAT_FALLBACK_PROVIDER=qwen
CHAT_FALLBACK_API_KEY=<阿里云百炼 API Key>
CHAT_FALLBACK_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
CHAT_FALLBACK_FLASH_MODEL=qwen3.5-flash-2026-02-23
CHAT_FALLBACK_PRO_MODEL=qwen3.7-plus

# 可选：按供应商当前价格填写每百万 Token 单价；留空则只统计 Token。
DEEPSEEK_FLASH_INPUT_PRICE_PER_MILLION=
DEEPSEEK_FLASH_OUTPUT_PRICE_PER_MILLION=
DEEPSEEK_PRO_INPUT_PRICE_PER_MILLION=
DEEPSEEK_PRO_OUTPUT_PRICE_PER_MILLION=
QWEN_FALLBACK_FLASH_INPUT_PRICE_PER_MILLION=
QWEN_FALLBACK_FLASH_OUTPUT_PRICE_PER_MILLION=
QWEN_FALLBACK_PRO_INPUT_PRICE_PER_MILLION=
QWEN_FALLBACK_PRO_OUTPUT_PRICE_PER_MILLION=

EMBEDDING_PROVIDER=qwen
EMBEDDING_API_KEY=<阿里云百炼 API Key>
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1536
EMBEDDING_VERSION=1

OCR_PROVIDER=qwen
OCR_API_KEY=<阿里云百炼 API Key，可与上面相同>
OCR_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OCR_MODEL=qwen3.5-ocr
OCR_FALLBACK_MODEL=qwen3.5-plus
OCR_MIN_CHARACTERS=20
OCR_MAX_PAGES=100
OCR_POLL_SECONDS=5
PDFTOPPM_PATH=pdftoppm
```

阿里云百炼的同一个 Key 可以在本地同时填入 `CHAT_FALLBACK_API_KEY`、`EMBEDDING_API_KEY` 和 `OCR_API_KEY`。各类专用配置优先于旧的 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，旧配置仅保留兼容。`EMBEDDING_DIMENSIONS` 固定为 `1536`，必须与数据库 `vector(1536)` 一致。只配置 DeepSeek 时，Agent 对话可用，但检索会安全降级为关键词模式，OCR Worker 会保持未配置状态。

新会话默认选择 Flash；Pro 只能由用户在 Agent 页面手动选择，切换只影响后续消息。DeepSeek 发生超时、限流、连接失败或 5xx 时重试一次，再切到对应档位的 Qwen；400、401、403 会直接报告配置问题，不错误触发备用模型。每条回答会显示实际 Provider/模型，数据库仅记录模型、Token、耗时、状态和备用切换，不保存密钥或对话正文到用量表。可通过 `GET /api/v1/analytics/model-usage?days=30` 查看当前账户的聚合指标。

OCR Worker 还需要 `SUPABASE_SERVICE_ROLE_KEY`，该密钥只能放在后端环境，不能写入根目录前端变量或提交到 Git。系统需安装 Poppler 的 `pdftoppm`，然后在另一个终端启动：

```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.workers.ocr
```

本地只处理一个队列任务用于验收时可增加 `--once`。API 负责把扫描 PDF 入队，Worker 才负责下载私有文件、逐页识别并完成入库；Worker 停止不会丢失任务。

## Supabase

1. 创建 Supabase Cloud 项目；迁移会启用 `vector` 和 `btree_gist` 扩展。
2. 按文件名顺序执行 `supabase/migrations/` 下的 SQL。
3. 在根目录 `.env.local` 填写 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 和 API 地址。
4. 在 `backend/.env` 填写相同项目的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`，并设置 `DEMO_MODE=false`。
5. 在 Supabase Auth 中启用 Email provider；开发阶段可按需要决定是否强制邮箱确认。
6. 执行 `202608120003_private_material_storage.sql` 后会创建私有 `study-materials` Storage bucket；资料原文件使用当前用户编号作为私有目录。
7. v0.8 先执行 `202608140001_private_hybrid_search.sql` 和 `202608140002_ocr_job_queue.sql`，再依次执行 `202608150001_agent_model_profiles.sql`、`202608150002_document_embedding_metadata.sql`、`202608150003_ocr_page_recovery.sql`、`202608150004_agent_model_usage.sql`。后四个迁移分别保存会话模型档位、文档向量来源、OCR 逐页失败信息和模型用量指标。
8. v0.9 执行 `202608190001_document_reindex.sql`，为资料增加分块版本和索引时间，并启用原子替换分块与扫描 PDF 重新入队。
9. v1.0 依次执行 `202608190002_grant_study_session_delete.sql` 和 `202608190003_validate_study_session_task.sql`，开放当前用户删除误录学习会话的权限，并保证学习会话关联同一用户、同一科目的任务。
10. v1.1 执行 `202608290001_sync_profile_display_name.sql`，让注册和账户设置中的学习昵称自动同步到受 RLS 保护的个人资料。
11. v1.2 执行 `202609020001_daily_target_completion.sql`，为年度热力图提供当前用户隔离的每日目标完成度聚合。
12. v1.3 依次执行 `202609020002_mistake_card_crud.sql` 和 `202609030001_agent_daily_plan_proposal.sql`，开放错题卡完整管理权限，并启用有数量和总时长上限的多任务提案原子审批。
13. v1.4 复用现有私有 Storage、资料分块字段与 RLS，不需要执行新的 SQL 迁移。
14. v1.5 复用现有院校、求职、资料、Agent 对话与审计表，不需要执行新的 SQL 迁移。

迁移包含学习任务、会话、错题、院校、资料分块、导入提案、Agent 提案、审计日志、RLS 和学习贡献聚合视图。

## 验证

```bash
npm run build
npm run lint
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest -q backend/tests
```

## v0.6 已完成的真实流程

1. 使用 Supabase Auth 注册、登录、恢复会话和退出，FastAPI 拒绝缺失、过期或无效 Token。
2. 在今日工作台创建任务，并通过用户 JWT 写入 PostgreSQL；云端配置完成后，服务重启数据仍然存在。
3. 开始、暂停、继续和结束专注，暂停时长不会计入有效学习时间。
4. 数据库拒绝同一用户重叠的学习会话，并按用户时区拆分跨午夜会话。
5. 热力图从只读聚合视图读取年度和科目统计，不单独维护积分数据。
6. 不同用户无法读取或修改彼此的任务、会话、资料记录或 Agent 提案。
7. 未配置 Supabase 时保留离线演示界面，但不会伪装成云端同步。
8. 阶段、周、日计划支持增删改查、状态流转、任务关联以及计划与实际统计。
9. 错题卡支持录入、到期筛选、复习反馈和下次复习时间更新。
10. 院校情报与求职副线按当前用户隔离，并支持 JSON、CSV、Markdown 导出。
11. PDF/Markdown 原文件写入私有 Storage，按哈希去重并保留页码或标题定位。
12. 私有资料关键词检索只返回当前用户且未被标记为恶意指令的文档片段。

## v0.7 已完成代码实现

1. Agent 会话、对话消息、操作提案、审批决定、幂等执行结果和审计日志持久化到 PostgreSQL。
2. 计划教练读取真实计划、任务、学习会话和错题；资料导师读取私有资料与可追溯网络来源。
3. OpenAI-compatible 模型可配置切换；未配置或调用失败时使用明确标记的安全降级回答。
4. 普通联网搜索不进入 RAG；用户批准导入提案后才安全下载、解析、去重并永久入库。
5. 刷新页面可恢复最近一次 Agent 对话与待审批提案，不会自动重放写入动作。
6. 支持主动新建对话、查看最近对话并切换历史线程；服务健康状态会明确展示模型与联网搜索是否已配置。
7. 顶部全局搜索支持快捷键与键盘导航；待处理事项数量会在进入工作台时后台预取，避免首次打开后才出现角标。
8. Agent 消息区支持自动滚动与复制回答，并保留停止等待和恢复历史对话能力。

`202608130001` 至 `202608130005` 五个 v0.7 云端迁移已经执行；真实 Agent 联调还需配置可选的模型与 Tavily 密钥。

## v0.8 已完成代码实现

1. 安全资料分块在入库时生成 1536 维 Embedding；恶意指令标记片段不会向量化或参与检索。
2. 私有检索使用语义与关键词双路召回及融合排序，并继续按用户、资料范围和安全标记过滤。
3. Embedding 服务缺失、超时或返回非法维度时自动降级为关键词检索，不阻断资料入库与答疑。
4. 扫描 PDF 自动进入持久化 OCR 队列，支持原子领取、失败退避、最大重试次数和手动重试。
5. 独立 OCR Worker 使用 `pdftoppm` 渲染页面和 OpenAI 兼容视觉模型识别文字，完成后统一执行安全扫描、切分和向量化。
6. Agent 新增 SSE 接口，真实模型 token 逐段传到浏览器；完整结束后才持久化回答，取消的半截回答不会进入历史记录。
7. 旧的非流式 Agent 接口继续保留，避免破坏已有客户端。
8. Agent 支持 DeepSeek Flash/Pro 白名单选择，并按相同档位降级到 Qwen；会话与每条回答保留实际模型元数据。
9. Qwen Embedding 固定 1536 维，并在文档上记录 Provider、模型、维度和版本，防止不同向量空间混用。
10. OCR 支持 Qwen OCR 与通用视觉模型二次识别，单页失败不会中止整份文档，并可重新处理失败页。
11. 模型调用记录请求次数、Token、耗时、错误率和备用切换次数，并提供当前用户隔离的统计接口。

v0.8 需要执行 `202608140001`、`202608140002`、`202608150001` 至 `202608150004` 六个云端迁移，并使用真实 DeepSeek/Qwen 密钥完成环境验收。供应商单价可能变化，系统不硬编码默认金额；填写本地可选单价后会返回估算成本，最终仍以供应商账单为准。

## v0.9 已完成代码实现

1. PDF 与 Markdown 改为按标题、段落和句子边界进行语义分块，分块目标约 1100 字符、上限 1600 字符，并保留页码、父级标题和相邻上下文重叠。
2. 私有检索继续使用关键词与 Embedding 双路召回，但默认只展示命中位置附近的摘要，不再把完整分块直接铺满页面。
3. 检索结果返回匹配词、检索模式和相关度；前端支持关键词高亮、限定单份资料以及按需展开完整上下文。
4. 资料记录保存 `chunking_version` 与 `indexed_at`，旧资料可以在页面点击“重新解析”升级到最新分块策略。
5. 文本资料使用事务 RPC 原子替换索引，失败时保留旧索引；扫描 PDF 重新进入 OCR 队列，完成后再替换分块。
6. 资料页面自动轮询排队、处理和等待 OCR 状态，并为失败记录提供重新处理入口。

v0.9 上线前必须执行 `202608190001_document_reindex.sql`。执行后进入资料库，对旧资料点击“重新解析”，待状态恢复为“索引就绪”后再用具体知识点进行检索验收。

## v1.0 已完成代码实现

1. 首页周完成率、连续学习天数、阶段名称与每日目标均从真实计划、任务和学习会话计算，不再使用云端账户的静态占位指标。
2. 今日任务支持创建、完成、编辑和删除，并展示计划时长、实际学习时长和完成进度。
3. 专注计时可以关联今日任务，支持暂停、继续、刷新恢复、结束记录和确认放弃；暂停时间不会计入有效学习时长。
4. 手动补录可以关联同科目任务，最近学习记录展示任务名称，并允许删除误录会话。
5. 首页展示今日各科学习时长结构；学科学习页面展示真实学习时长、任务完成、待复习错题和最近学习日期。
6. 数据库触发器校验学习会话与任务属于同一用户且科目一致，前端不能绕过所有权边界关联其他账户的数据。
7. 学习会话发生增删后同步刷新任务实际时长、首页统计与年度热力图。

v1.0 上线前需要执行 `202608190002_grant_study_session_delete.sql` 和 `202608190003_validate_study_session_task.sql`。本分支已通过前端 77 项测试、后端 158 项测试、ESLint、Ruff 和生产构建；正式合并仍以 GitHub Pull Request CI 结果为准。

## v1.4 已完成代码实现

1. 私有 PDF 与 Markdown 原文件通过携带用户 JWT 的接口读取；响应禁止缓存和 MIME 猜测，非 PDF 文本按沙箱策略展示。
2. 阅读器使用浏览器临时 Blob URL 打开 PDF，关闭或替换内容时释放 URL；Markdown 以纯文本方式呈现，不执行文档内 HTML 或脚本。
3. 用户可逐份点击“缓存索引”，把当前账户、当前资料的安全原文片段保存到当前浏览器的 IndexedDB；不会自动下载，也不会缓存被标记为不可信指令的片段。
4. 设备缓存键包含账户与资料编号，资料版本或分块版本变化后自动失效；用户可逐份点击“移除本地”清除。
5. 私有检索先执行本地关键词匹配；本地命中时查询不发送到后端，没有缓存、没有命中或浏览器缓存不可用时回退云端关键词/Embedding 混合检索。

本地索引保存的是可读原文片段，不是加密保险箱；共用电脑上应使用独立的系统账户或浏览器配置，并在离开前移除本地缓存。该能力要求应用先恢复登录身份，因此是“登录后的本地优先检索”，不等同于完全离线应用，也不包含本地向量模型。v1.4 不新增数据库结构，无需执行 SQL 迁移。

## v1.5 已完成代码实现

1. 院校情报、资料库和求职副线都提供资料导师快捷入口；问题只预填且可编辑，不会自动发送。
2. Agent 只在问题涉及院校或求职时加载对应的当前用户记录；结构化分析不会无故触发 Embedding 或私有 RAG。
3. 院校快捷入口带入当前筛选的招生年份，后端按该年份隔离档案；求职上下文优先面试中、已投递、进行中和待开始的可行动记录。
4. 回答和历史对话保留院校档案与求职记录引用，并与个人资料、网页来源分开展示。
5. 用户已保存的院校档案始终标记为历史记录，不会伪装成本次联网核验；联网未配置、调用失败或未搜到结果时都会明确说明。

v1.5 不新增数据库结构，无需执行 SQL 迁移。正式验收应分别从院校、资料和求职页进入 Agent，确认预填问题可编辑、回答来源可辨认，且纯分析不会产生业务写入。

## 安全约定

- 不提交 `.env`、API Key、Supabase service role key 或个人学习资料。
- 网络资料只有在用户批准导入提案后才永久保存。
- Agent 不直接写业务数据，所有变更经过提案、确认、幂等执行和审计。
- 公开演示必须使用脱敏账户和虚构数据。

## License

[MIT](LICENSE)
