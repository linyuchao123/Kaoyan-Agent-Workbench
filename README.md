# 研途 · Kaoyan Agent Workbench

面向 2028 考研的个人 AI 学习工作台。它把任务、专注计时、GitHub 风格学习热力图、错题复习、院校情报、私有资料 RAG 与双 Agent 学习助手放在同一个可追踪的学习闭环中。

> 当前状态：`v0.8` 核心代码已完成，等待云端迁移与真实模型环境验收。登录、学习闭环、三级计划、错题复习、院校与求职、资料库、联网搜索、双 Agent、Embedding 混合检索、扫描 PDF OCR 队列、来源引用、确认入库、提案审批、多轮对话恢复和 SSE 流式回答均已接通。

## 产品能力

- 年度学习热力图：按有效学习时长显示五档颜色，支持数学、英语、政治、408 和项目筛选。
- 今日工作台：任务创建与完成、可暂停专注计时、学习会话写入和在线状态提示。
- 快捷入口：顶部支持全局搜索、任务与错题快速记录，以及云端待处理事项汇总；搜索可用 `Ctrl/⌘ + K` 唤起并通过方向键与 Enter 操作。
- 三级计划：阶段、周、日计划及计划偏差。
- 学科与错题：章节进度、薄弱点和复习安排。
- 院校情报：信息精确到学院、专业代码、招生年份和官方来源。
- 双 Agent：计划教练与资料导师使用 LangGraph 路由，读取真实个人上下文；写入操作只生成可编辑、可拒绝、可幂等批准的持久化提案。
- Agent 对话：支持主动开始新对话、查看最近对话并恢复历史消息；回答通过 SSE 逐段显示，新消息自动滚动且回答可一键复制，存在待审批提案时禁止误切换会话。
- 长请求保护：Agent 生成期间可以停止流式请求；未完整回答不会写入对话历史，提案仍遵守人工确认边界。
- 私有 RAG：PDF/Markdown 上传、文件哈希去重、按标题或页码切分、Embedding 与全文索引混合检索已经可用；模型不可用时自动保留关键词检索。
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

### v0.8 AI 与 OCR 配置

在 `backend/.env` 中按使用的 OpenAI 兼容服务填写：

```dotenv
OPENAI_API_KEY=
OPENAI_BASE_URL=
CHAT_MODEL=gpt-5-mini
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
OCR_MODEL=gpt-5-mini
OCR_MAX_PAGES=100
OCR_POLL_SECONDS=5
PDFTOPPM_PATH=pdftoppm
```

`EMBEDDING_DIMENSIONS` 必须与迁移中的 `vector(1536)` 一致。若不配置模型密钥，上传与检索仍可工作，但 `/health` 会报告 `rag.mode=keyword`，不会伪装成混合检索。

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
7. v0.8 依次执行 `202608140001_private_hybrid_search.sql` 和 `202608140002_ocr_job_queue.sql`；前者建立按用户隔离的混合检索函数，后者建立 OCR 队列及原子领取、完成和失败重试函数。

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

v0.8 需要执行 `202608140001`、`202608140002` 两个云端迁移，并使用真实 Embedding/OCR/Chat 模型完成环境验收。

## 安全约定

- 不提交 `.env`、API Key、Supabase service role key 或个人学习资料。
- 网络资料只有在用户批准导入提案后才永久保存。
- Agent 不直接写业务数据，所有变更经过提案、确认、幂等执行和审计。
- 公开演示必须使用脱敏账户和虚构数据。

## License

[MIT](LICENSE)
