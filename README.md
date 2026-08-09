# 研途 · Kaoyan Agent Workbench

面向 2028 考研的个人 AI 学习工作台。它把任务、专注计时、GitHub 风格学习热力图、错题复习、院校情报、私有资料 RAG 与双 Agent 学习助手放在同一个可追踪的学习闭环中。

> 当前状态：`v0.1` 本地可运行原型。前端核心交互与后端 API 契约已建立；Supabase、模型、Embedding 和 Tavily 需要使用自己的密钥启用真实云能力。

## 产品能力

- 年度学习热力图：按有效学习时长显示五档颜色，支持数学、英语、政治、408 和项目筛选。
- 今日工作台：任务完成、专注计时、快速记录与学习建议。
- 三级计划：阶段、周、日计划及计划偏差。
- 学科与错题：章节进度、薄弱点和复习安排。
- 院校情报：信息精确到学院、专业代码、招生年份和官方来源。
- 双 Agent：计划教练与资料导师使用 LangGraph 编排，写入前必须确认。
- 混合 RAG：PDF、Markdown、网页的全文 + 向量检索，回答保留页码和链接。
- 联网搜索：Tavily 搜索结果默认临时使用，确认后才能导入资料库。

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

API 文档位于 `http://localhost:8000/docs`。未配置外部密钥时，API 使用安全演示模式，不会产生外部调用。

## Supabase

1. 创建 Supabase 项目并启用 `vector` 扩展。
2. 执行 `supabase/migrations/202608100001_initial.sql`。
3. 复制前后端 `.env.example` 并填写项目 URL 和密钥。
4. 创建私有资料 bucket；服务端写入，客户端只使用短期签名 URL。

迁移包含学习任务、会话、错题、院校、资料分块、导入提案、Agent 提案、审计日志、RLS 和学习贡献聚合视图。

## 验证

```bash
npm run build
PYTHONPATH=backend python -m unittest discover -s backend/tests
```

## 安全约定

- 不提交 `.env`、API Key、Supabase service role key 或个人学习资料。
- 网络资料只有在用户批准导入提案后才永久保存。
- Agent 不直接写业务数据，所有变更经过提案、确认、幂等执行和审计。
- 公开演示必须使用脱敏账户和虚构数据。

## License

[MIT](LICENSE)
