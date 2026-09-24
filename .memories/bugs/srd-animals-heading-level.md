# Bug: Only 238 SRD monsters parsed (animals missing)
Status: fixed (2026-09-24)
Area: server / rules

## Overview
The catalog test expected more than 250 monsters but got 238. `spawn_monster("wolf")` fell back to
generic stats.

## Root cause / Fix
`animals.md` uses `## Name` + `### Actions`, while `monsters-A-Z.md` uses `### Name` + `#### Actions`.
The loader now splits each file at its own heading level, and the chunker treats stat-block
subsections at h3 or h4 as part of the block. Plural matching was improved (wolves → wolf,
harpies → harpy). About 330 monsters now parse.

## Completed
- 2026-09-24: Fixed, with a test.
