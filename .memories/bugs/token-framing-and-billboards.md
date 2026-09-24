# Bug: Party tokens off-screen; standees looked squashed
Status: fixed (2026-09-24)
Area: web

## Overview
On a 22×14 map at 1600×900, the left columns (where the party starts) were cut off. Standee
sprites looked like flat ellipses from the steep camera.

## Root cause / Fix
- The camera distance heuristic ignored fov. FitCamera now uses
  `dist = max((h+2)/view, (w+2)/(view·aspect))·1.05` with `view = 2·tan(fov/2)`.
- The Billboard used `lockX lockZ` (upright plane). It now faces the camera fully.

## Completed
- 2026-09-24: Fixed; verified by screenshot.
