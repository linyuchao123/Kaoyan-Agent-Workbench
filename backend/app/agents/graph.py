import asyncio
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.agents.context import AgentContext
from app.agents.model import AgentModel
from app.services.rag import choose_retrieval_mode


class WorkbenchState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    route: Literal["coach", "tutor", "combined"]
    requested_route: Literal["coach", "tutor", "combined"]
    retrieval_mode: Literal["private", "web", "hybrid"]
    user_id: str
    context: AgentContext
    answer: str
    model_status: Literal["generated", "fallback"]
    proposal_ids: list[str]


def route_request(state: WorkbenchState) -> WorkbenchState:
    requested_route = state.get("requested_route")
    if requested_route:
        text = str(state["messages"][-1].content).lower()
        return {"route": requested_route, "retrieval_mode": choose_retrieval_mode(text)}
    text = str(state["messages"][-1].content).lower()
    coach_markers = ("计划", "复盘", "任务", "时间", "进度", "安排")
    tutor_markers = ("解释", "资料", "为什么", "招生", "检索", "题目", "知识点")
    coach = any(marker in text for marker in coach_markers)
    tutor = any(marker in text for marker in tutor_markers)
    route: Literal["coach", "tutor", "combined"] = (
        "combined" if coach and tutor else "coach" if coach else "tutor"
    )
    return {"route": route, "retrieval_mode": choose_retrieval_mode(text)}


def coach_fallback(state: WorkbenchState) -> str:
    context = state.get("context", {})
    plans = context.get("active_plans", [])
    tasks = context.get("pending_tasks", [])
    mistakes = context.get("due_mistakes", [])
    sessions = context.get("recent_sessions", [])
    effective_minutes = context.get("recent_effective_minutes", 0)
    summary = (
        f"计划教练已读取你的云端学习记录：进行中计划 {len(plans)} 个，"
        f"未完成任务 {len(tasks)} 个，到期错题 {len(mistakes)} 道；"
        f"最近 {len(sessions)} 次学习共 {effective_minutes} 分钟。"
    )
    if mistakes:
        advice = f"建议优先复习到期错题「{mistakes[0]['title']}」，完成后再安排新任务。"
    elif tasks:
        advice = f"当前建议先完成「{tasks[0]['title']}」，避免继续扩大计划与实际偏差。"
    else:
        advice = "目前没有待处理任务或到期错题，可以先建立今天最重要的一项学习任务。"
    return f"{summary}\n{advice}\n任何写入仍会先生成待确认提案。"


def tutor_fallback(state: WorkbenchState) -> str:
    mode = state.get("retrieval_mode", "private")
    context = state.get("context", {})
    sources = context.get("private_sources", [])
    web_sources = context.get("web_sources", [])
    sections = []
    if sources:
        citations = "\n".join(
            f"- 《{source['title']}》{source['locator']}：{source['content']}" for source in sources
        )
        sections.append(f"个人资料来源（{len(sources)}）：\n{citations}")
    if web_sources:
        web_citations = "\n".join(
            f"- {source['title']}（{source['url']}，访问时间 {source['accessed_at']}）："
            f"{source['snippet']}"
            for source in web_sources
        )
        sections.append(f"网络来源（{len(web_sources)}）：\n{web_citations}")
    if sections:
        return "资料导师找到以下可回溯证据：\n" + "\n".join(sections)
    if mode in {"web", "hybrid"}:
        status = context.get("web_search_status", "unconfigured")
        reason = "尚未配置 Tavily API Key" if status == "unconfigured" else "联网检索失败"
        return f"资料导师没有取得可核验的网络来源（{reason}），因此不会自行补全答案。"
    return "资料导师未在你的私有资料中找到足够证据，因此不会自行补全答案。"


def choose_branch(state: WorkbenchState) -> str:
    return state.get("route", "tutor")


def build_graph(model: AgentModel):
    async def coach_subgraph(state: WorkbenchState) -> WorkbenchState:
        fallback = coach_fallback(state)
        question = str(state["messages"][-1].content)
        answer = await model.generate(
            agent="coach",
            question=question,
            context=state.get("context", {}),
            fallback=fallback,
        )
        return {
            "answer": answer or fallback,
            "model_status": "generated" if answer else "fallback",
        }

    async def tutor_subgraph(state: WorkbenchState) -> WorkbenchState:
        fallback = tutor_fallback(state)
        context = state.get("context", {})
        if not context.get("private_sources") and not context.get("web_sources"):
            return {"answer": fallback, "model_status": "fallback"}
        question = str(state["messages"][-1].content)
        answer = await model.generate(
            agent="tutor",
            question=question,
            context=state.get("context", {}),
            fallback=fallback,
        )
        return {
            "answer": answer or fallback,
            "model_status": "generated" if answer else "fallback",
        }

    async def combined_subgraph(state: WorkbenchState) -> WorkbenchState:
        coach, tutor = await asyncio.gather(coach_subgraph(state), tutor_subgraph(state))
        model_status = (
            "generated"
            if "generated" in {coach["model_status"], tutor["model_status"]}
            else "fallback"
        )
        return {"answer": f"{coach['answer']}\n{tutor['answer']}", "model_status": model_status}

    graph = StateGraph(WorkbenchState)
    graph.add_node("route", route_request)
    graph.add_node("coach", coach_subgraph)
    graph.add_node("tutor", tutor_subgraph)
    graph.add_node("combined", combined_subgraph)
    graph.add_edge(START, "route")
    graph.add_conditional_edges(
        "route", choose_branch, {"coach": "coach", "tutor": "tutor", "combined": "combined"}
    )
    graph.add_edge("coach", END)
    graph.add_edge("tutor", END)
    graph.add_edge("combined", END)
    return graph.compile()
