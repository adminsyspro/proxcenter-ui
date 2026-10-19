# Tiny Flask sidecar that exposes WeasyPrint's HTML → PDF rendering as a
# REST API. The orchestrator (`internal/reports/renderer/client.go`) calls
# `POST /render` with HTML in the body and expects PDF bytes back. The
# `GET /health` endpoint is the boot probe used in the docker-compose
# healthcheck.

FROM python:3.13-slim AS base

# WeasyPrint runtime: needs Cairo/Pango/HarfBuzz/GdkPixbuf and a few fonts.
# `fonts-dejavu-core` keeps the layer small while covering Latin, accented
# characters and basic Cyrillic; `fonts-wqy-microhei` (a few MB) covers the
# Chinese and Korean the UI is translated into, without which a report in
# those languages prints blank labels. Other scripts can mount extra fonts at
# /usr/share/fonts/.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libcairo2 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --only-binary :all: blocks running setup scripts during install
# (sonar docker:S8541): wheels exist on PyPI for weasyprint, flask and
# gunicorn on linux/amd64, so the build still succeeds.
RUN pip install --no-cache-dir --only-binary :all: \
        weasyprint==66.0 \
        flask==3.1.0 \
        gunicorn==23.0.0

COPY server.py ./

# Non-root runtime user.
RUN groupadd --system --gid 1001 weasy && \
    useradd  --system --uid 1001 --gid weasy weasy
USER weasy

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request, sys; r = urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=3); sys.exit(0 if r.status == 200 else 1)" || exit 1

# 2 sync workers is enough for the orchestrator's report cadence; heavy PDFs
# block one worker for a few seconds, the second keeps /health responsive.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120", "server:app"]
