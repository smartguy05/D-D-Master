import { useCallback, useEffect, useRef, useState } from "react";
import type { CreationChoices, CreationOptions, CreationView } from "@dm/shared";
import { api, del, patch as patchApi } from "../../lib/api";
import { onCreation } from "../../lib/useServer";

/** Record fields: a change replaces the whole object (sent as clear + value; see mergeChoices). */
const RECORD_FIELDS = new Set<keyof CreationChoices>(["speciesChoices", "baseAbilities", "backgroundBonuses", "featPicks"]);
export const PATCH_DELAY_MS = 400;

export interface Creation {
  view: CreationView | null;
  options: CreationOptions | null;
  /** The choices as the player sees them (local edits included, before the server has them). */
  choices: CreationChoices;
  error: string | null;
  setError(e: string | null): void;
  /** Change fields (debounced PATCH). `undefined` clears a field. */
  change(fields: CreationChoices): void;
  /** Run an action that returns a fresh view (join, submit, roll…); pending edits are sent first. */
  act(path: string, body?: unknown): Promise<void>;
  reset(): Promise<void>;
  busy: boolean;
}

/**
 * The seat's character draft (GET/PATCH /api/players/:id/creation). The server's `creation` event
 * (no content) triggers a refetch; local edits win until their PATCH is answered.
 */
export function useCreation(playerId: string, connected: boolean, campaignId?: string): Creation {
  const [view, setView] = useState<CreationView | null>(null);
  const [options, setOptions] = useState<CreationOptions | null>(null);
  const [choices, setChoices] = useState<CreationChoices>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = useRef<CreationChoices>({});
  const dirty = useRef(new Set<keyof CreationChoices>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inFlight = useRef(0);

  const take = useCallback((v: CreationView) => {
    setView(v);
    // Fields typed since the last PATCH stay as typed.
    const merged = { ...v.draft.choices } as Record<string, unknown>;
    for (const k of dirty.current) merged[k] = local.current[k];
    local.current = merged as CreationChoices;
    setChoices(local.current);
  }, []);

  const refresh = useCallback(() => {
    if (inFlight.current || dirty.current.size) return; // our own PATCH answer is on the way
    api<CreationView>(`/players/${playerId}/creation`)
      .then(take)
      .catch((e) => setError((e as Error).message));
  }, [playerId, take]);

  useEffect(() => {
    if (connected && campaignId) refresh();
  }, [connected, campaignId, refresh]);
  useEffect(() => onCreation((ev) => ev.playerId === playerId && refresh()), [playerId, refresh]);
  // The options depend on the campaign's level.
  const level = view?.level;
  useEffect(() => {
    if (!connected || !campaignId || level === undefined) return;
    api<CreationOptions>(`/players/${playerId}/creation/options`)
      .then(setOptions)
      .catch(() => undefined);
  }, [connected, campaignId, level, playerId]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const fields = [...dirty.current];
    if (!fields.length) return;
    dirty.current = new Set();
    const body: Record<string, unknown> = {};
    const clear: string[] = [];
    for (const k of fields) {
      const value = local.current[k];
      if (value === undefined || RECORD_FIELDS.has(k)) clear.push(k);
      if (value !== undefined) body[k] = value;
    }
    inFlight.current++;
    try {
      const v = await patchApi(`/players/${playerId}/creation`, { choices: body, clear });
      inFlight.current--;
      take(v as CreationView);
    } catch (e) {
      inFlight.current--;
      setError((e as Error).message);
      dirty.current = new Set();
      refresh();
    }
  }, [playerId, take, refresh]);

  const change = useCallback(
    (fields: CreationChoices) => {
      local.current = { ...local.current, ...fields };
      for (const k of Object.keys(fields) as (keyof CreationChoices)[]) {
        if (fields[k] === undefined) delete local.current[k];
        dirty.current.add(k);
      }
      setChoices(local.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), PATCH_DELAY_MS);
    },
    [flush],
  );

  const act = useCallback(
    async (path: string, body: unknown = {}) => {
      setError(null);
      setBusy(true);
      try {
        await flush();
        take(await api<CreationView>(`/players/${playerId}/creation${path}`, body));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [flush, playerId, take],
  );

  const reset = useCallback(async () => {
    clearTimeout(timer.current);
    dirty.current = new Set();
    try {
      take((await del(`/players/${playerId}/creation`)) as CreationView);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [playerId, take]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { view, options, choices, error, setError, change, act, reset, busy };
}
