# Bug: ?next= on /login and /join was an open redirect via tab/newline
Status: fixed (2026-10-22)
Area: web (lib/auth.ts)

## Overview
`safeNext` refused `//` and `/\` but browsers drop ASCII tab, CR and LF while parsing a URL, so
`/login?next=%2F%09%2Fevil.com` reached `safeNext` as `/\t/evil.com`, passed, and after sign-in
`location.assign` went to `https://evil.com/`: a phishing path for the host password.

## Repro
`new URL("/\t/evil.com", "https://dnd.example.com/login").href` → `https://evil.com/`.

## Root cause / Fix
String-prefix checks don't match how the browser parses. `safeNext` now refuses backslashes and
control characters, resolves the value with `new URL(next, base)` and keeps it only when the origin
is unchanged, returning `pathname + search + hash`.

## Notes
- Tests: apps/web/src/lib/auth.test.ts ("refuses paths that a browser would turn into another site").

## TODOs

## Completed
- 2026-10-22: fixed with tests, before the phase 1 commit.
