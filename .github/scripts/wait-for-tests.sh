#!/usr/bin/env bash
# docker-publish.yml builds its images while the tests run, and only pushes
# them once both test jobs of this run attempt have passed. This blocks until
# `test` and `test-backend` are done and fails unless they succeeded, so an
# image never reaches the registry ahead of a red test. `test-backend` may be
# skipped for Dependabot only, as the build jobs always allowed.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

deadline=$(( $(date +%s) + ${WAIT_TIMEOUT_SECONDS:-2700} ))
url="repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100"

while :; do
  states=$(gh api "$url" --jq '.jobs[] | select(.name == "test" or .name == "test-backend") | "\(.name)=\(.status)/\(.conclusion // "")"')
  test_state=$(grep '^test=' <<<"$states" | cut -d= -f2 || true)
  backend_state=$(grep '^test-backend=' <<<"$states" | cut -d= -f2 || true)

  backend_ok=false
  case "$backend_state" in
    completed/success) backend_ok=true ;;
    completed/skipped)
      if [[ "${GITHUB_ACTOR:-}" == "dependabot[bot]" ]]; then backend_ok=true; else fail "test-backend was skipped"; fi ;;
    completed/*) fail "test-backend finished as ${backend_state#completed/}" ;;
  esac
  case "$test_state" in
    completed/success)
      if [[ "$backend_ok" == true ]]; then echo "Tests passed, pushing."; exit 0; fi ;;
    completed/*) fail "test finished as ${test_state#completed/}" ;;
  esac

  (( $(date +%s) < deadline )) || fail "tests still running after ${WAIT_TIMEOUT_SECONDS:-2700}s (test=${test_state:-none}, test-backend=${backend_state:-none})"
  sleep 15
done
