import socket
from unittest import IsolatedAsyncioTestCase

from app.services.security import UnsafeUrlError, validate_resolved_public_url
from app.services.web_import import html_to_markdown


class WebImportTests(IsolatedAsyncioTestCase):
    async def test_resolved_private_address_is_rejected(self):
        async def resolver(host, port):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]

        with self.assertRaises(UnsafeUrlError):
            await validate_resolved_public_url("https://public.example/file", resolver)

    async def test_resolved_public_address_is_allowed(self):
        async def resolver(host, port):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

        url = await validate_resolved_public_url("https://example.com/file", resolver)
        self.assertEqual(url, "https://example.com/file")

    def test_html_is_converted_to_searchable_markdown_without_scripts(self):
        title, content = html_to_markdown(
            b"<html><head><title>Exam Guide</title><script>bad()</script></head>"
            b"<body><h1>Subjects</h1><p>Math and CS408</p></body></html>",
            "Fallback",
        )
        text = content.decode()
        self.assertEqual(title, "Exam Guide")
        self.assertIn("Math and CS408", text)
        self.assertNotIn("bad()", text)
