# 研途 · Kaoyan Agent Workbench

面向 2028 考研的个人 AI 学习工作台。它把任务、专注计时、GitHub 风格学习热力图、错题复习、院校情报、私有资料 RAG 与双 Agent 学习助手放在同一个可追踪的学习闭环中。

> 当前状态：`v0.2` 本地学习闭环。任务、计时会话、热力图聚合、资料解析和 Agent 提案审批已接入 FastAPI。Supabase 数据迁移已经就绪；云仓库适配、真实模型/Embedding、OCR worker 和 Tavily 密钥配置仍是后续开发项。

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

API 文档位于 `http://localhost:8000/docs`。当前业务记录使用进程内开发仓库，重启 API 后会清空；它用于验证完整交互，不替代 Supabase。未配置外部密钥时不会产生模型或联网搜索调用。

前端会自动连接 `http://localhost:8000`。API 未启动时页面保留演示数据，并明确显示“离线演示模式”；API 启动后任务、计时和热力图立即使用真实会话数据。

## Supabase

1. 创建 Supabase 项目并启用 `vector` 扩展。
2. 执行 `supabase/migrations/202608100001_initial.sql`。
3. 复制前后端 `.env.example` 并填写项目 URL 和密钥。
4. 创建私有资料 bucket；服务端写入，客户端只使用短期签名 URL。

迁移包含学习任务、会话、错题、院校、资料分块、导入提案、Agent 提案、审计日志、RLS 和学习贡献聚合视图。

## 验证

```bash
npm run build
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest -q backend/tests
```

## v0.2 已完成的真实流程

1. 在今日工作台创建任务，并同步到 FastAPI。
2. 开始、暂停、继续和结束专注，暂停时长不会计入有效学习时间。
3. 后端拒绝同一用户重叠的学习会话，并按上海时区拆分跨午夜会话。
4. 热力图按年度和科目请求聚合接口，不单独维护积分数据。
5. 上传 PDF/Markdown 后计算 SHA-256、去重、保留页码/标题定位，并标记扫描 PDF 的 OCR 回退状态。
6. Agent 运行生成待确认提案，只有批准后才写入任务；重复批准不会重复创建。

## 安全约定

- 不提交 `.env`、API Key、Supabase service role key 或个人学习资料。
- 网络资料只有在用户批准导入提案后才永久保存。
- Agent 不直接写业务数据，所有变更经过提案、确认、幂等执行和审计。
- 公开演示必须使用脱敏账户和虚构数据。

## License

[MIT](LICENSE)
