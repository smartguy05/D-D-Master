# Bug: roll_dice accepts a removed creature as roller
Status: open
Area: server (engine rolls)

## Overview
`roll_dice` with the `roller_id` of a monster that was removed is not rejected. The roll is logged
and shown with `rollerName` = the raw id ("mon_255c2c2762") and counts as that creature's save.

## Repro
Test run 2026-10-19: the host removed Kobold Warrior 1; the DM (stale id) rolled "Kobold Warrior 3
Wisdom save vs Sleep" with `roller_id: mon_255c2c2762` (event 499). It went through.

## Root cause / Fix
`makeRoll` takes `rollerId` without resolving it. Fix: `roll_dice` throws "Unknown roller" for an id
that matches no character or monster, so the DM refreshes with `get_party_status`.

## TODOs
- [ ] Validate roller_id + test
## Completed
