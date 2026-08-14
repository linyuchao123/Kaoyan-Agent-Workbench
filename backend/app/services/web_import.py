from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlparse

import httpx

from app.services.security import validate_resolved_public_url

MAX_DOCUMENT_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class DownloadedWebDocument:
    final_url: str
    title: str
    filename: str
    content_type: str
    content: bytes


class _HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self._in_title = False
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "title":
            self._in_title = True
        if tag in {"script", "style", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in {"script", "style", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text or self._ignored_depth:
            return
        if self._in_title:
            self.title_parts.append(text)
        else:
            self.text_parts.append(text)


def html_to_markdown(content: bytes, fallback_title: str) -> tuple[str, bytes]:
    extractor = _HtmlTextExtractor()
    extractor.feed(content.decode("utf-8", errors="replace"))
    title = " ".join(extractor.title_parts).strip() or fallback_title
    body = "\n\n".join(extractor.text_parts)
    return title[:160], f"# {title}\n\n{body}".encode()


async def download_public_document(url: str) -> DownloadedWebDocument:
    current_url = await validate_resolved_public_url(url)
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        for _ in range(6):
            async with client.stream("GET", current_url) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("redirect response has no location")
                    current_url = await validate_resolved_public_url(urljoin(current_url, location))
                    continue
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > MAX_DOCUMENT_BYTES:
                        raise ValueError("document exceeds the 25 MB limit")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                path_name = unquote(urlparse(current_url).path.rsplit("/", 1)[-1])
                fallback_title = (
                    path_name.rsplit(".", 1)[0] or urlparse(current_url).hostname or "网页资料"
                )
                if content_type == "application/pdf" or path_name.lower().endswith(".pdf"):
                    filename = (
                        path_name if path_name.lower().endswith(".pdf") else f"{fallback_title}.pdf"
                    )
                    return DownloadedWebDocument(
                        current_url,
                        fallback_title[:160],
                        filename,
                        "application/pdf",
                        bytes(content),
                    )
                if content_type not in {"text/html", "text/plain", "text/markdown", ""}:
                    raise ValueError("only public HTML, text, Markdown or PDF can be imported")
                title, markdown = html_to_markdown(bytes(content), fallback_title)
                return DownloadedWebDocument(
                    current_url, title, f"{title}.md", "text/markdown", markdown
                )
    raise ValueError("too many redirects")
