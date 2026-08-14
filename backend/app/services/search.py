from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from langchain_tavily._utilities import TavilySearchAPIWrapper

from app.config import Settings


@dataclass(frozen=True)
class WebResult:
    title: str
    url: str
    snippet: str
    accessed_at: datetime


class WebSearchProvider(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def configured(self) -> bool: ...

    async def search(
        self, query: str, include_domains: list[str] | None = None
    ) -> list[WebResult]: ...

    async def extract(self, url: str) -> str: ...


class TavilySearchProvider:
    def __init__(self, settings: Settings):
        if not settings.tavily_api_key:
            raise RuntimeError("TAVILY_API_KEY is required for live web search")
        self.api_wrapper = TavilySearchAPIWrapper(tavily_api_key=settings.tavily_api_key)

    @property
    def name(self) -> str:
        return "tavily"

    @property
    def configured(self) -> bool:
        return True

    async def search(self, query: str, include_domains: list[str] | None = None) -> list[WebResult]:
        from langchain_tavily import TavilySearch

        tool = TavilySearch(
            max_results=6,
            include_domains=include_domains or None,
            api_wrapper=self.api_wrapper,
        )
        response = await tool.ainvoke({"query": query})
        raw_results = response.get("results", []) if isinstance(response, dict) else []
        now = datetime.now(UTC)
        return [
            WebResult(
                title=result.get("title") or result.get("url", "网页来源"),
                url=result["url"],
                snippet=result.get("content", ""),
                accessed_at=now,
            )
            for result in raw_results
            if result.get("url")
        ]

    async def extract(self, url: str) -> str:
        from langchain_tavily import TavilyExtract

        response = await TavilyExtract(api_wrapper=self.api_wrapper).ainvoke({"urls": [url]})
        return str(response)


class DemoSearchProvider:
    @property
    def name(self) -> str:
        return "demo"

    @property
    def configured(self) -> bool:
        return False

    async def search(self, query: str, include_domains: list[str] | None = None) -> list[WebResult]:
        return []

    async def extract(self, url: str) -> str:
        return f"Demo extraction for {url}"


def get_search_provider(settings: Settings) -> WebSearchProvider:
    return TavilySearchProvider(settings) if settings.tavily_api_key else DemoSearchProvider()
