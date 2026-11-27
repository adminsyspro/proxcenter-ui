"""Tests of the sidecar, run inside the built image (stdlib unittest only).

    docker run --rm --network none -v "$PWD/weasyprint/tests:/app/tests:ro" <image> \
        python -m unittest discover -s /app/tests

The resource policy is the security boundary of the renderer: tenant content
(custom CSS, an uploaded SVG logo) reaches WeasyPrint, so no URL other than a
data: URI may ever be fetched from inside the container.
"""

import base64
import logging
import unittest
import urllib.request
from unittest import mock

import server

# fontTools logs every subset at DEBUG; keep the test output readable.
logging.getLogger("fontTools").setLevel(logging.WARNING)

# 1x1 transparent PNG.
PIXEL = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )
).decode()

FORBIDDEN_URLS = [
    "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data/",
    "https://example.com/style.css",
    "ftp://example.com/x",
    "gopher://127.0.0.1:5000/",
    "FILE:///etc/hostname",
    "/etc/passwd",
    "../server.py",
]


class FetcherPolicyTest(unittest.TestCase):
    def test_refuses_every_non_data_url(self):
        fetcher = server.InlineOnlyURLFetcher()
        for url in FORBIDDEN_URLS:
            with self.subTest(url=url), self.assertRaises(ValueError):
                fetcher.fetch(url)

    def test_serves_data_uris(self):
        res = server.InlineOnlyURLFetcher().fetch(f"data:image/png;base64,{PIXEL}")
        try:
            self.assertTrue(res.read().startswith(b"\x89PNG"))
        finally:
            res.close()


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_health(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), {"status": "ok"})

    def test_empty_body_is_rejected(self):
        res = self.client.post("/render", data="")
        self.assertEqual(res.status_code, 400)

    def test_rendering_failure_keeps_the_exception_text_in(self):
        secret = "/app/secret/path.py line 42 <b>tenant</b>"
        with mock.patch.object(server.HTML, "write_pdf", side_effect=RuntimeError(secret)), \
                self.assertLogs("weasyprint-sidecar", level="ERROR") as logs:
            res = self.client.post("/render", data="<p>x</p>", content_type="text/html")

        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.get_json(), {"error": "PDF rendering failed, see the reporting sidecar log"})
        self.assertNotIn(secret, res.get_data(as_text=True))
        # The operator still gets the cause, in the sidecar log.
        self.assertIn(secret, "\n".join(logs.output))

    def test_renders_inline_content(self):
        html = f'<html><body><h1>Report</h1><img src="data:image/png;base64,{PIXEL}"></body></html>'
        res = self.client.post("/render", data=html, content_type="text/html")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "application/pdf")
        self.assertTrue(res.data.startswith(b"%PDF"))

    def test_only_data_uris_reach_urllib(self):
        refs = "".join(
            f'<img src="{u}"><link rel="stylesheet" href="{u}"><link rel="attachment" href="{u}">'
            for u in FORBIDDEN_URLS
        )
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            '<image href="file:///etc/passwd"/><image xlink:href="http://127.0.0.1:5000/health"/></svg>'
        )
        css = "<style>@import url('file:///etc/passwd'); @font-face { font-family: x; src: url('http://127.0.0.1/f.woff'); } body { background: url('file:///etc/hostname'); }</style>"
        html = f"<html><head>{css}</head><body>{refs}{svg}<p>x</p></body></html>"

        real_fetch = server.InlineOnlyURLFetcher.fetch
        real_open = urllib.request.OpenerDirector.open
        with mock.patch.object(server.InlineOnlyURLFetcher, "fetch", autospec=True, side_effect=real_fetch) as policy, \
                mock.patch.object(urllib.request.OpenerDirector, "open", autospec=True, side_effect=real_open) as opener:
            res = self.client.post("/render", data=html, content_type="text/html")

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data.startswith(b"%PDF"))
        # The render really goes through the policy (it saw the references)...
        asked = [c.args[1] for c in policy.call_args_list]
        self.assertTrue(any(u.startswith("file:") for u in asked), asked)
        # ...and nothing but a data: URI reached urllib.
        opened = [getattr(c.args[1], "full_url", c.args[1]) for c in opener.call_args_list]
        self.assertTrue(all(u.startswith("data:") for u in opened), opened)

if __name__ == "__main__":
    unittest.main()
