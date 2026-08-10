# 研途 · Kaoyan Agent Workbench

面向 2028 考研的个人 AI 学习工作台。它把任务、专注计时、GitHub 风格学习热力图、错题复习、院校情报、私有资料 RAG 与双 Agent 学习助手放在同一个可追踪的学习闭环中。

> 当前状态：`v0.3` 云端学习闭环代码已完成。Supabase Auth、用户 JWT、PostgreSQL Repository、RLS、任务/计时/热力图云端读写和离线演示模式已接通；创建 Supabase 项目并配置密钥后启用真实持久化。真实模型/Embedding、OCR worker 和 Tavily 密钥配置仍是后续开发项。

## 产品能力

- 年度学习热力图：按有效学习时长显示五档颜色，支持数学、英语、政治、408 和项目筛选。
- 今日工作台：任务创建与完成、可暂停专注计时、学习会话写入和在线状态提示。
- 三级计划：阶段、周、日计划及计划偏差。
- 学科与错题：章节进度、薄弱点和复习安排。
- 院校情报：信息精确到学院、专业代码、招生年份和官方来源。
- 双 Agent：计划教练与资料导师使用 LangGraph 编排，写入前必须确认。
- 混合 RAG：PDF/Markdown 上传、文件哈希去重、按标题或页码切分、全文 + 向量检索契约。
- 联网搜索：Tavily 搜索结果默认临时使用，确认后才能导入资料库。
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

## Supabase

1. 创建 Supabase Cloud 项目；迁移会启用 `vector` 和 `btree_gist` 扩展。
2. 按文件名顺序执行 `supabase/migrations/` 下的 SQL。
3. 在根目录 `.env.local` 填写 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 和 API 地址。
4. 在 `backend/.env` 填写相同项目的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`，并设置 `DEMO_MODE=false`。
5. 在 Supabase Auth 中启用 Email provider；开发阶段可按需要决定是否强制邮箱确认。
6. 后续接资料云存储时再创建私有 Storage bucket；v0.3 不上传原文件到云端。

迁移包含学习任务、会话、错题、院校、资料分块、导入提案、Agent 提案、审计日志、RLS 和学习贡献聚合视图。

## 验证

```bash
npm run build
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest -q backend/tests
```

## v0.3 已完成的真实流程

1. 使用 Supabase Auth 注册、登录、恢复会话和退出，FastAPI 拒绝缺失、过期或无效 Token。
2. 在今日工作台创建任务，并通过用户 JWT 写入 PostgreSQL；云端配置完成后，服务重启数据仍然存在。
3. 开始、暂停、继续和结束专注，暂停时长不会计入有效学习时间。
4. 数据库拒绝同一用户重叠的学习会话，并按用户时区拆分跨午夜会话。
5. 热力图从只读聚合视图读取年度和科目统计，不单独维护积分数据。
6. 不同用户无法读取或修改彼此的任务、会话、资料记录或 Agent 提案。
7. 未配置 Supabase 时保留离线演示界面，但不会伪装成云端同步。

## 安全约定

- 不提交 `.env`、API Key、Supabase service role key 或个人学习资料。
- 网络资料只有在用户批准导入提案后才永久保存。
- Agent 不直接写业务数据，所有变更经过提案、确认、幂等执行和审计。
- 公开演示必须使用脱敏账户和虚构数据。

## License

[MIT](LICENSE)
