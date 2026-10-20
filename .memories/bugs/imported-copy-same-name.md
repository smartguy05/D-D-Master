# Bug: an imported campaign has the same name as the original
Status: open
Area: server (campaign import) / web

## Overview
Importing an export of a campaign that still exists creates a second row with the identical name
("Claude Test Run" twice), so the host can't tell which is which before loading.

## Repro
Test run 2026-10-19: export cmp_cbe6567b3b, import → cmp_e84bd99921, same name.

## Root cause / Fix
`importCampaign` keeps `campaign.name`. Fix: add " (imported)" / " (copy 2)" when the name is taken,
or show the created date in the list.

## TODOs
- [ ] Unique name on import + test
## Completed
