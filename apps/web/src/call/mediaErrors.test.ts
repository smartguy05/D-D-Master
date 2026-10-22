import { describe, expect, it } from "vitest";
import { cameraFailure, nextCameraError, shownCallError } from "./mediaErrors";

const domErr = (name: string, message = "nope") => Object.assign(new Error(message), { name });

describe("cameraFailure (a getUserMedia video error)", () => {
  it("no webcam, access denied or no matching camera: the camera pref turns off", () => {
    for (const name of ["NotFoundError", "NotAllowedError", "OverconstrainedError"]) expect(cameraFailure(domErr(name)).turnOff).toBe(true);
  });

  it("a passing failure (camera busy) keeps the pref so the next try can work", () => {
    expect(cameraFailure(domErr("NotReadableError", "busy"))).toEqual({ message: "Camera: busy", turnOff: false });
  });
});

describe("nextCameraError (the camera note under the strip)", () => {
  const failed = (name: string) => nextCameraError(undefined, { kind: "failed", err: domErr(name) });

  it("a capture that works, or a new try, clears it", () => {
    const e = failed("NotReadableError");
    expect(e).toBeDefined();
    expect(nextCameraError(e, { kind: "ok" })).toBeUndefined();
    expect(nextCameraError(e, { kind: "start" })).toBeUndefined();
  });

  it("turning the camera off clears it, unless the failure itself turned it off (the note says why)", () => {
    expect(nextCameraError(failed("NotReadableError"), { kind: "off" })).toBeUndefined();
    const denied = failed("NotAllowedError");
    expect(nextCameraError(denied, { kind: "off" })).toBe(denied);
  });
});

describe("shownCallError", () => {
  it("the mic and the camera are separate; both show", () => {
    expect(shownCallError({})).toBeUndefined();
    expect(shownCallError({ mic: "Microphone: x" })).toBe("Microphone: x");
    expect(shownCallError({ mic: "Microphone: x", camera: { message: "Camera: y", turnOff: true } })).toBe("Microphone: x · Camera: y");
  });
});
