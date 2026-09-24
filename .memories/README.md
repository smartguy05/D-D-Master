# Project memories

Durable working knowledge for humans and AI assistants. **Docs** (`docs/`) describe how the system
works now. **Memories** record what we're doing, why, what's left, and what went wrong.

```
.memories/
  features/<feature>.md   one file per feature
  bugs/<short-slug>.md    one file per bug (open or fixed)
  general/<topic>.md      decisions, API quirks, environment notes, conventions
```

## Feature file format

```markdown
# Feature: <name>
Status: planned | in-progress | done (vertical slice) | polished
Docs: docs/... (links)

## Overview
## Notes        (design decisions, gotchas, links to code)
## TODOs        (- [ ] checkboxes)
## Completed    (- YYYY-MM-DD: what shipped)
```

## Bug file format

```markdown
# Bug: <title>
Status: open | fixed (YYYY-MM-DD)
Area: <server|web|...>

## Overview     (symptom)
## Repro
## Root cause / Fix
## Notes
## TODOs
## Completed
```

Update the relevant memory in the same change as the code. Move TODOs to Completed with a date
when they ship. Every bug you find gets a bug file, even if it was fixed right away.
