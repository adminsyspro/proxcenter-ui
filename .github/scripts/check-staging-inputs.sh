#!/usr/bin/env bash
# Staging dispatch of docker-publish.yml: refuse anything that could publish
# a staging build under a release tag, from a tag ref, or with half of its
# inputs. Everything comes from the environment, never expanded inline.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

if [[ "${INPUT_STAGING:-false}" != "true" ]]; then
  if [[ -n "${INPUT_FRONTEND_REF:-}" || -n "${INPUT_BACKEND_REF:-}" ]]; then
    fail "frontend_ref and backend_ref are only honoured with staging=true"
  fi
  exit 0
fi

[[ "${GH_EVENT:-}" == "workflow_dispatch" ]] || fail "staging=true is for a manual dispatch only"
[[ "${GH_REF:-}" == refs/heads/* ]] || fail "dispatch a staging build from a branch, not from ${GH_REF:-an unknown ref}"
[[ "${INPUT_VERSION:-}" =~ ^([0-9]+\.[0-9]+\.[0-9]+-)?staging$ ]] || fail "a staging version is 'staging' or 'X.Y.Z-staging', not '${INPUT_VERSION:-}'"
ref_re='^[A-Za-z0-9][A-Za-z0-9._/-]*$'
[[ "${INPUT_FRONTEND_REF:-}" =~ $ref_re ]] || fail "frontend_ref is required with staging=true"
[[ "${INPUT_BACKEND_REF:-}" =~ $ref_re ]] || fail "backend_ref is required with staging=true"
echo "Staging build ${INPUT_VERSION}: frontend ${INPUT_FRONTEND_REF}, backend ${INPUT_BACKEND_REF}"
