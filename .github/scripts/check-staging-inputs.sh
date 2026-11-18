#!/usr/bin/env bash
# Manual dispatch of docker-publish.yml: refuse anything that could publish
# under a release tag without going through a tag. A staging build must not
# take a release tag, start from a tag ref or come with half of its inputs;
# any other dispatch runs from main and only names a release candidate.
# Everything comes from the environment, never expanded inline.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

if [[ "${INPUT_STAGING:-false}" != "true" ]]; then
  if [[ -n "${INPUT_FRONTEND_REF:-}" || -n "${INPUT_BACKEND_REF:-}" ]]; then
    fail "frontend_ref and backend_ref are only honoured with staging=true"
  fi
  # Pushes, tags and pull requests carry no input: only a dispatch is checked.
  # Its version becomes an image tag as it is, so a free value would let any
  # branch overwrite the images of a published release (1.5.0, 1.5, 1).
  if [[ "${GH_EVENT:-}" == "workflow_dispatch" ]]; then
    [[ "${GH_REF:-}" == "refs/heads/main" ]] || fail "dispatch from main, not from ${GH_REF:-an unknown ref}: another branch is built with staging=true"
    version="${INPUT_VERSION:-}"
    [[ -z "$version" || "$version" == "latest" || "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+$ ]] || fail "a dispatch version is 'latest' or 'X.Y.Z-rcN', not '$version': a release is published by its tag"
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
