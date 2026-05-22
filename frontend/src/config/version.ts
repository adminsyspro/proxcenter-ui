// Configuration de version ProxCenter.
//
// Source of truth: `frontend/package.json#version`. The Docker build inlines
// the workflow-resolved tag value into NEXT_PUBLIC_APP_VERSION (e.g. "1.4.1"
// for a v1.4.1 tag, "dev" for a main push). At runtime, the env var wins so
// production always shows what the workflow tagged. In `npm run dev` the env
// var is absent, so we fall back to package.json, which `npm version` keeps
// in sync on every release. Bump package.json before tagging or the dev
// banner will be stale.
import pkg from '../../package.json'

export const VERSION_NAME = 'ProxCenter'
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version
export const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA || ''
export const GITHUB_REPO = 'adminsyspro/proxcenter-ui'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
