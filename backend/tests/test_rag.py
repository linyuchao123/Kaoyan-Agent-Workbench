from unittest import TestCase
from uuid import UUID

from app.schemas import PrivateKnowledgeSource
from app.services.rag import (
    enrich_private_source,
    private_search_snippet,
    private_search_terms,
)


class PrivateSearchPresentationTests(TestCase):
    def test_exact_query_is_returned_as_explainable_match(self):
        content = "函数是从定义域到值域的一种对应关系。函数的定义需要明确对应法则。"

        terms = private_search_terms("函数的定义", content)

        self.assertEqual(terms[0], "函数的定义")

    def test_snippet_is_centered_on_match_instead_of_document_start(self):
        content = "开头背景。" * 100 + "函数的定义位于这里。" + "后续内容。" * 100

        snippet = private_search_snippet(content, ["函数的定义"])

        self.assertIn("函数的定义", snippet)
        self.assertLessEqual(len(snippet), 480)
        self.assertTrue(snippet.startswith("…"))
        self.assertTrue(snippet.endswith("…"))

    def test_source_keeps_full_content_and_adds_retrieval_metadata(self):
        content = "函数是映射。" * 100 + "函数的定义。" + "性质说明。" * 100
        source = PrivateKnowledgeSource(
            chunk_id=1,
            document_id=UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            title="高等数学",
            heading="函数",
            page_number=1,
            locator="第 1 页 · 函数",
            content=content,
            score=1.0,
        )

        enriched = enrich_private_source(source, "函数的定义", "hybrid")

        self.assertEqual(enriched.content, content)
        self.assertIn("函数的定义", enriched.snippet)
        self.assertEqual(enriched.retrieval_mode, "hybrid")
        self.assertEqual(enriched.matched_terms[0], "函数的定义")
