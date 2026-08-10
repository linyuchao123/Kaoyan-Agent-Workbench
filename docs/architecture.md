# 研途架构说明

## 系统边界

```text
React / Vite PWA
  ├─ 今日工作台、热力图、计划、学科、院校、资料库
  ├─ Supabase Auth 登录与离线草稿
  └─ SSE Agent 对话与提案确认
             │
             ▼
FastAPI API ─────────────── Supabase
  ├─ 学习与计划 API          ├─ PostgreSQL + RLS
  ├─ 导入、检索与引用         ├─ Storage
  ├─ Agent 提案事务           └─ pgvector + 全文检索
  └─ 审计与幂等
             │
             ▼
LangGraph 主路由
  ├─ 计划教练子图（只读工具 → 写入提案）
  ├─ 资料导师子图（私有 RAG / Web / Hybrid）
  └─ Human-in-the-loop（批准 / 编辑 / 拒绝）
```

## 关键约束

- `study_sessions` 是学习时长的唯一事实来源，热力图使用只读聚合视图。
- 私有资料与向量片段都带 `user_id`，向量查询也必须经过 RLS。
- 网络搜索结果默认是临时证据；必须批准 `import_proposal` 才能永久入库。
- 文档正文永远是不可信输入，不能改变系统提示词或直接调用工具。
- Agent 不拥有直接写业务表的工具，只能创建 `action_proposal`；应用提案时使用幂等键和事务。
- 数据库通过 GiST 排他约束拒绝同一用户的重叠会话；贡献视图按用户时区拆分跨日会话，并按比例扣除暂停时间。
- `DEMO_MODE=true` 使用按用户隔离的进程内 Repository；`DEMO_MODE=false` 切换到 Supabase Repository，所有 PostgREST 请求携带用户 JWT 并继续受到 RLS 约束。

## RAG 数据流

1. 上传 PDF/Markdown 或批准网页导入。
2. 计算 SHA-256，按用户去重，原文件写入私有 Storage。
3. PDF 优先提取文本，低文本密度页面进入 OCR 回退。
4. 按标题和页码切成 600–900 tokens，重叠约 100 tokens。
5. 同时写入全文索引和 1536 维向量。
6. 查询执行关键词 + 向量混合召回，通过 Reciprocal Rank Fusion 合并。
7. 只把通过相关性校验的片段送入模型，并强制输出 locator。

## 当前实现层级

- `v0.3`：前端已接入 Supabase 邮箱密码登录、会话恢复与退出；FastAPI 通过 Supabase Auth 验证 Bearer Token，并将任务、会话和贡献统计切换到可配置的 Supabase Repository。
- 仓库边界：Demo Repository 用于测试和离线联调；Supabase Repository 使用用户 JWT 访问 PostgREST，不使用前端提交的 `user_id`，云端模式下数据可跨设备持久化。
- 数据迁移：覆盖计划、任务、会话、知识点、做题记录、错题复习、院校、求职、资料、搜索、Agent 和审计实体。
- 私有资料：Markdown 按标题切分，PDF 按页切分；低文本密度 PDF 标记为 `ocr_required`，待接入正式 OCR worker。
- 联网资料：预览阶段校验公开 URL，默认不保存；批准导入后才进入下载、解析和向量化队列。

## Agent 路由

- 包含计划、任务、进度、时间：计划教练。
- 包含资料、知识点、招生、最新信息：资料导师。
- 同时包含两类意图：两个子图并行，汇总节点合并结果。
- “最新、当前、招生简章”等词触发 Web 检索；“我的资料、讲义、笔记”等词优先私有 RAG。
