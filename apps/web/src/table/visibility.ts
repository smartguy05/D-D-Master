/**
 * The table's visibility rules live in @dm/shared (packages/shared/src/visibility.ts) so the server
 * can project player payloads with the same rules (docs/server/state-projection.md). Re-exported
 * here so the TV's imports and behaviour are unchanged.
 */
export { effectForTable, initiativeForTable, interactiveFeatureShownOnTable, mapObjectShownOnTable, momentForTable, monsterShownOnTable, rollForTable } from "@dm/shared";
