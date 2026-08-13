import asyncio
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.agents.context import AgentContext
from app.services.rag import choose_retrieval_mode


class WorkbenchState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    route: Literal["coach", "tutor", "combined"]
    requested_route: Literal["coach", "tutor", "combined"]
    retrieval_mode: Literal["private", "web", "hybrid"]
    user_id: str
    context: AgentContext
    answer: str
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


async def coach_subgraph(state: WorkbenchState) -> WorkbenchState:
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
    return {"answer": f"{summary}\n{advice}\n任何写入仍会先生成待确认提案。"}


async def tutor_subgraph(state: WorkbenchState) -> WorkbenchState:
    mode = state.get("retrieval_mode", "private")
    sources = state.get("context", {}).get("private_sources", [])
    if sources:
        citations = "\n".join(
            f"- 《{source['title']}》{source['locator']}：{source['content']}" for source in sources
        )
        answer = f"资料导师在你的私有资料中找到 {len(sources)} 个相关片段：\n{citations}"
    else:
        answer = "资料导师未在你的私有资料中找到足够证据，因此不会自行补全答案。"
    if mode in {"web", "hybrid"}:
        answer += "\n该问题还需要联网来源；当前结果仅包含已核验的个人资料证据。"
    return {"answer": answer}


async def combined_subgraph(state: WorkbenchState) -> WorkbenchState:
    coach, tutor = await asyncio.gather(coach_subgraph(state), tutor_subgraph(state))
    return {"answer": f"{coach['answer']}\n{tutor['answer']}"}


def choose_branch(state: WorkbenchState) -> str:
    return state.get("route", "tutor")


def build_graph():
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
