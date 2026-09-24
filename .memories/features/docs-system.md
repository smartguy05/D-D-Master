# Feature: Documentation + memory system
Status: done
Docs: docs/README.md, CLAUDE.md

## Overview
docs/ grouped by area (architecture, server, web, gameplay, setup, reference). Each file is ≤500
lines and has audit front matter. scripts/docs_index.py (stdlib only) supports find, topic, list,
rebuild, check, stale and audit. docs/index.json is generated. .memories/ holds features, bugs and
general notes.

## TODOs
- [ ] Wire `pnpm docs:check` into CI once CI exists

## Completed
- 2026-09-24: 23 docs, index, script, CLAUDE.md instructions.
