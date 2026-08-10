import asyncio
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.services.rag import choose_retrieval_mode


class WorkbenchState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    route: Literal["coach", "tutor", "combined"]
    requested_route: Literal["coach", "tutor", "combined"]
    retrieval_mode: Literal["private", "web", "hybrid"]
    user_id: str
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
    # Production implementation injects read-only study tools and returns proposals only.
    return {"answer": "计划教练已完成分析；所有计划调整将先生成待确认提案。"}


async def tutor_subgraph(state: WorkbenchState) -> WorkbenchState:
    # Production implementation performs private/web/hybrid retrieval and citation validation.
    mode = state.get("retrieval_mode", "private")
    return {"answer": f"资料导师已使用 {mode} 检索；回答必须包含可回溯来源。"}


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
