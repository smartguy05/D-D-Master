# Bug: One PC's death ended the whole campaign, so resurrection was impossible
Status: fixed (2026-10-20)
Area: server / realtime / web

## Overview
When one party member died, the campaign ended in failure. Once `Campaign.status` is `failed`, the
DM's instructions say "don't start new scenes", so the party could not revive the fallen PC.

## Repro
Two or more PCs, voice DM connected. One PC dies (massive damage or a third failed death save). The
DM calls `end_campaign {outcome: failure}`. The campaign is failed and play is over. In a one-PC
test, the TV's `defeat` banner (every PC at 0 HP) looks like the same thing.

## Root cause / Fix
Nothing in the server decided when deaths end a campaign. `end_campaign` accepted a DM failure at
any time, and the persona's "the party wiped out for good" left it to the model's judgment.
Fix:
- New `Campaign.deathRule`: `party_wipe` (default) or `any_death`.
- `GameService.runTool` checks `deathRuleEnds` (engine/moments.ts) after every engine tool and ends
  the campaign by itself (source `auto`, `campaign_ended` in the tool output, a system note).
- `endCampaign` refuses a DM failure until `deathRuleMet`. The host can always end it.
- The persona says never to end the campaign because one PC died, and states the rule.
- The host sets the rule on the Adventure tab (`PATCH /api/campaign/settings`).

Tests:
- engine/moments.test.ts "death rule"
- game/service.moments.test.ts "death rule"
- service.host-note.test.ts
- realtime/instructions.test.ts
- shared schemas.moments.test.ts

## Notes
- "Dead" means the `Dead` condition. Unconscious and Stable PCs don't count toward a wipe.
- Host character edits (`updateCharacter`) don't trigger the auto end; the host has End campaign.

## TODOs

## Completed
- 2026-10-20: Fixed with regression tests.
