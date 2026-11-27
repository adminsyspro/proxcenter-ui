"""Minimal HTML → PDF sidecar built on WeasyPrint + Flask.

The Go orchestrator (proxcenter-backend) calls this service through
`internal/reports/renderer/client.go`. Two endpoints are required:

    POST /render
        Body: text/html
        Returns: application/pdf

    GET /health
        Returns: 200 OK with a tiny JSON body so docker-compose can probe it.

Errors come back as JSON with a non-2xx status — the Go client surfaces the
body as the error message. A rendering failure answers a fixed message; its
traceback is only written to the sidecar log.
"""

import logging

from flask import Flask, Response, jsonify, request
from weasyprint import HTML
from weasyprint.urls import URLFetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("weasyprint-sidecar")

app = Flask(__name__)


class InlineOnlyURLFetcher(URLFetcher):
    """Serve `data:` URIs, refuse everything else.

    Every caller inlines its resources (CSS in <style>, images and fonts as
    data URIs), so a fetch for any other scheme can only come from content a
    tenant controls: a custom stylesheet, an uploaded SVG logo whose <image>
    points at an internal address, a <link rel="attachment" href="file:///...">.
    WeasyPrint's default fetcher would follow http(s) and file URLs from inside
    this container, so the policy is enforced here, at the last hop, whatever
    upstream validation let through. Redirects are off as well: a data: URI
    cannot redirect, and nothing else gets this far. A refused resource is
    dropped with a warning in the render log; the PDF is still produced.
    """

    def __init__(self):
        super().__init__(timeout=5, allowed_protocols={"data"}, allow_redirects=False)

    def fetch(self, url, headers=None):
        if not url.startswith("data:"):
            raise ValueError(f"external resources are not allowed: {url.split(':', 1)[0]}: URL refused")
        return super().fetch(url, headers)


def _error(message: str, status: int) -> Response:
    res = jsonify(error=message)
    res.status_code = status
    return res


@app.get("/health")
def health() -> Response:
    return jsonify(status="ok")


@app.post("/render")
def render() -> Response:
    html = request.get_data(as_text=True)
    if not html:
        return _error("empty html body", 400)

    try:
        # Callers embed CSS, images and fonts inline; InlineOnlyURLFetcher
        # turns any other resource reference into a logged miss instead of a
        # network or filesystem access from this container.
        pdf_bytes = HTML(string=html, url_fetcher=InlineOnlyURLFetcher()).write_pdf()
    except Exception:  # noqa: BLE001 — any rendering failure becomes a 500.
        # The traceback stays in this container's log; the caller only gets a
        # fixed message, so no exception text (file paths, library internals,
        # fragments of the submitted HTML) leaves the sidecar.
        log.exception("PDF rendering failed")
        return _error("PDF rendering failed, see the reporting sidecar log", 500)

    return Response(pdf_bytes, mimetype="application/pdf")


if __name__ == "__main__":
    # Local dev convenience. Production runs through gunicorn (see CMD in
    # Dockerfile), which binds 0.0.0.0 inside the container so other
    # containers can reach it. The dev entrypoint stays on 127.0.0.1 to
    # avoid exposing the WeasyPrint port on the host network by accident.
    app.run(host="127.0.0.1", port=5000)
