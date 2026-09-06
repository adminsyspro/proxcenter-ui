"""Minimal HTML → PDF sidecar built on WeasyPrint + Flask.

The Go orchestrator (proxcenter-backend) calls this service through
`internal/reports/renderer/client.go`. Two endpoints are required:

    POST /render
        Body: text/html
        Returns: application/pdf

    GET /health
        Returns: 200 OK with a tiny JSON body so docker-compose can probe it.

Errors come back as JSON with a non-2xx status — the Go client surfaces the
body as the error message.
"""

import logging

from flask import Flask, Response, jsonify, request
from weasyprint import HTML, default_url_fetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("weasyprint-sidecar")

app = Flask(__name__)


def inline_only_url_fetcher(url: str, *args, **kwargs):
    """Serve `data:` URIs, refuse everything else.

    Every caller inlines its resources (CSS in <style>, images and fonts as
    data URIs), so a fetch for any other scheme can only come from content a
    tenant controls: a custom stylesheet, an uploaded SVG logo whose <image>
    points at an internal address, a <link rel="attachment" href="file:///...">.
    WeasyPrint's default fetcher would follow http(s) and file URLs from inside
    this container, so the policy is enforced here, at the last hop, whatever
    upstream validation let through. A refused resource is dropped with a
    warning in the render log; the PDF is still produced.
    """
    if url.startswith("data:"):
        return default_url_fetcher(url, *args, **kwargs)
    raise ValueError(f"external resources are not allowed: {url.split(':', 1)[0]}: URL refused")


@app.get("/health")
def health() -> Response:
    return jsonify(status="ok")


@app.post("/render")
def render() -> Response:
    html = request.get_data(as_text=True)
    if not html:
        return jsonify(error="empty html body"), 400

    try:
        # Callers embed CSS, images and fonts inline; inline_only_url_fetcher
        # turns any other resource reference into a logged miss instead of a
        # network or filesystem access from this container.
        pdf_bytes = HTML(string=html, url_fetcher=inline_only_url_fetcher).write_pdf()
    except Exception as exc:  # noqa: BLE001 — surface the rendering failure verbatim.
        log.exception("PDF rendering failed")
        return jsonify(error=str(exc)), 500

    return Response(pdf_bytes, mimetype="application/pdf")


if __name__ == "__main__":
    # Local dev convenience. Production runs through gunicorn (see CMD in
    # Dockerfile), which binds 0.0.0.0 inside the container so other
    # containers can reach it. The dev entrypoint stays on 127.0.0.1 to
    # avoid exposing the WeasyPrint port on the host network by accident.
    app.run(host="127.0.0.1", port=5000)
