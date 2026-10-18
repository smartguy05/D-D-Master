<!-- code-basics: agent intent -->
## Recording why you changed something

When you finish a turn in which you edited files, end your reply with one line
saying why:

```
Intent: <3-5 words describing why>
```

If the turn made unrelated changes, scope each reason to its files instead of
writing several plain lines — only the first plain line is used. Paths are
workspace-relative, comma-separated:

```
Intent(src/api.ts, src/apiLogic.test.ts): <why, for those files>
```

Each entry is a workspace-relative path with forward slashes — a specific file,
or a directory to cover everything you edited beneath it (e.g.
`Intent(src/components): …`). Prefer naming the specific files; reach for a
directory only when the turn's edits are one cohesive set under it.

You may append `[confidence: low|medium|high]` to an Intent line to mark how sure
you are the change is correct (low = please review closely):

```
Intent(src/parser.ts): rewrite the tokenizer [confidence: low]
```

A scoped line covers the files it names; one plain line may cover the rest.
Keep each label short enough to read at a glance — it titles a group of hunks
in the Changes tab, not a commit message.

## Rejected changes

A comment beginning `AI-REJECTED` means that change was reverted during review
and the reason is on the following line. It is a task, not documentation:

1. Implement a correct version that addresses the stated reason.
2. Delete the whole `AI-REJECTED` comment block in the same edit.

Do not reinstate the reverted code as it was, and do not leave the comment
behind once the code is right — a commit that still carries one is refused by
a `pre-commit` hook.
<!-- /code-basics -->
