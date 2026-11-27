# Tiny Flask sidecar that exposes WeasyPrint's HTML → PDF rendering as a
# REST API. The orchestrator (`internal/reports/renderer/client.go`) calls
# `POST /render` with HTML in the body and expects PDF bytes back. The
# `GET /health` endpoint is the boot probe used in the docker-compose
# healthcheck.

# Pinned by digest so a rebuild never picks up a different base silently;
# Dependabot (docker, /weasyprint) moves the digest.
FROM python:3.13-slim@sha256:7249d5587b78209a006dc4a3b5340678f84ea729239193aa559962cd8c1fce50 AS base

# WeasyPrint runtime: needs Cairo/Pango/HarfBuzz/GdkPixbuf and a few fonts.
# libharfbuzz-subset0 subsets the embedded fonts (WeasyPrint 70 warns that
# its fontTools fallback is going away).
# `fonts-inter` is the face the reports ask for first (the "sans" stack of
# internal/reports/template_settings.go); without it they fell back to DejaVu.
# `fonts-dejavu-core` keeps the layer small while covering Latin, accented
# characters and basic Cyrillic; `fonts-wqy-microhei` (a few MB) covers the
# Chinese and Korean the UI is translated into, without which a report in
# those languages prints blank labels. Other scripts can mount extra fonts at
# /usr/share/fonts/.
# The upgrade pulls the Debian security fixes published after the pinned base
# was built (Trivy scans the result on every build).
# PACKAGES_REFRESH (the UTC day, passed by the CI) is only there to change
# the cache key: a layer restored from the build cache would otherwise keep
# the packages of the day it was first built, whatever Debian fixed since.
ARG PACKAGES_REFRESH
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        libcairo2 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libharfbuzz-subset0 \
        libffi8 \
        shared-mime-info \
        fonts-inter \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --only-binary :all: blocks running setup scripts during install
# (sonar docker:S8541): every pinned package ships a linux/amd64 wheel.
# requirements.txt pins the whole tree with hashes (pip-compile of
# requirements.in), so a tampered or swapped upload fails the build, and
# Dependabot (pip, /weasyprint) proposes the bumps.
# pip is removed once the tree is installed: the sidecar never installs
# anything at runtime, and pip's vendored urllib3/msgpack are otherwise
# reported (and patched) on pip's schedule, not ours.
COPY requirements.txt ./
RUN pip install --no-cache-dir --only-binary :all: --require-hashes -r requirements.txt \
    && pip uninstall -y pip \
    && rm -rf /usr/local/lib/python3.13/ensurepip

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
# No control socket: nothing manages gunicorn at runtime, and the non-root
# user has no home to put it in.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120", "--no-control-socket", "server:app"]
