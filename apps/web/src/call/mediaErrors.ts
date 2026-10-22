/**
 * The call's media errors (call/useCall.ts, docs/web/online-call.md#media-errors), kept apart so one
 * never hides or clears the other: the mic's, and the camera's. A camera that isn't there, was denied
 * or can't match turns the camera pref off (the toggle then tells the truth); a passing failure
 * (busy) keeps it so the next try can work.
 */

export interface CameraError {
  message: string;
  /** The failure turned the camera pref off. */
  turnOff: boolean;
}

export interface CallErrors {
  mic?: string;
  camera?: CameraError;
}

/** getUserMedia errors that won't go away by asking again. */
const LASTING = new Set(["NotFoundError", "NotAllowedError", "OverconstrainedError"]);

export function cameraFailure(err: unknown): CameraError {
  const e = err as { name?: string; message?: string } | null;
  return { message: `Camera: ${e?.message || e?.name || "unavailable"}`, turnOff: LASTING.has(e?.name ?? "") };
}

export function micFailure(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  return `Microphone: ${e?.message || e?.name || "unavailable"}`;
}

export type CameraEvent = { kind: "start" } | { kind: "ok" } | { kind: "off" } | { kind: "failed"; err: unknown };

/**
 * The camera note after a capture event: a new try or a working capture clears it; turning the camera
 * off clears it unless the failure itself turned it off (then the note says why the toggle is off).
 */
export function nextCameraError(prev: CameraError | undefined, ev: CameraEvent): CameraError | undefined {
  switch (ev.kind) {
    case "failed":
      return cameraFailure(ev.err);
    case "off":
      return prev?.turnOff ? prev : undefined;
    default:
      return undefined;
  }
}

/** The one line under the strip. */
export function shownCallError(e: CallErrors): string | undefined {
  return [e.mic, e.camera?.message].filter(Boolean).join(" · ") || undefined;
}
