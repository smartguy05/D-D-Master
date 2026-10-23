/**
 * The phone's "Your voice" card (PhoneVoice.tsx): record this player's voiceprint on the phone, and use
 * the phone as their mic toward the DM (docs/web/player-view.md#your-voice-on-the-phone). Pure parts.
 */

/** This phone may use its mic: a secure page (https, or localhost) with getUserMedia. */
export function micAllowed(w: { isSecureContext?: boolean; navigator?: { mediaDevices?: unknown } }): boolean {
  return !!w.isSecureContext && !!w.navigator?.mediaDevices;
}

/**
 * The same page over the server's HTTPS listener (browsers block the mic on plain http off localhost),
 * or undefined when there is none (HTTPS_PORT=0) or this page is already secure.
 */
export function secureUrl(loc: { protocol: string; hostname: string; pathname: string; search?: string }, httpsPort: number | undefined): string | undefined {
  if (loc.protocol === "https:" || !httpsPort) return undefined;
  const host = loc.hostname.includes(":") ? `[${loc.hostname}]` : loc.hostname;
  return `https://${host}:${httpsPort}${loc.pathname}${loc.search ?? ""}`;
}

/** Where the phone remembers "use my phone as my mic", per seat. */
export const phoneMicKey = (playerId: string) => `dm.phoneMic.${playerId}`;

export function loadPhoneMic(storage: Pick<Storage, "getItem"> | undefined, playerId: string): boolean {
  try {
    return storage?.getItem(phoneMicKey(playerId)) === "1";
  } catch {
    return false;
  }
}

export function savePhoneMic(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, playerId: string, on: boolean) {
  try {
    if (on) storage?.setItem(phoneMicKey(playerId), "1");
    else storage?.removeItem(phoneMicKey(playerId));
  } catch {
    // Private mode or blocked storage: the toggle just isn't remembered.
  }
}

/** The line under the phone-mic toggle: joined, waiting, or why not. */
export function phoneMicStatus(o: { joined: boolean; refused?: string; error?: string; hasMic: boolean }): string {
  if (o.error) return o.error;
  if (o.refused) return o.refused;
  if (!o.joined) return "Connecting your phone to the table…";
  if (!o.hasMic) return "Waiting for the microphone…";
  return "Your phone is your mic: hold Talk to speak to the DM.";
}

/** The voiceprint line: how many samples, or none yet. */
export function samplesLabel(samples: number): string {
  if (samples <= 0) return "The DM doesn't know your voice yet.";
  return samples === 1 ? "Voice recorded (1 sample)." : `Voice recorded (${samples} samples).`;
}
