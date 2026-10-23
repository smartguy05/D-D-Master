import { describe, expect, it } from "vitest";
import { loadPhoneMic, micAllowed, phoneMicKey, phoneMicStatus, samplesLabel, savePhoneMic, secureUrl } from "./phoneVoice";

describe("micAllowed", () => {
  it("needs a secure page with mediaDevices", () => {
    expect(micAllowed({ isSecureContext: true, navigator: { mediaDevices: {} } })).toBe(true);
    expect(micAllowed({ isSecureContext: false, navigator: { mediaDevices: {} } })).toBe(false);
    expect(micAllowed({ isSecureContext: true, navigator: {} })).toBe(false);
  });
});

describe("secureUrl", () => {
  it("the same page on the HTTPS port, or nothing when already secure or without one", () => {
    expect(secureUrl({ protocol: "http:", hostname: "192.168.1.20", pathname: "/player/pl_1", search: "?x=1" }, 8443)).toBe("https://192.168.1.20:8443/player/pl_1?x=1");
    expect(secureUrl({ protocol: "https:", hostname: "dnd.example.com", pathname: "/player/pl_1" }, 8443)).toBeUndefined();
    expect(secureUrl({ protocol: "http:", hostname: "192.168.1.20", pathname: "/player/pl_1" }, 0)).toBeUndefined();
    expect(secureUrl({ protocol: "http:", hostname: "fe80::1", pathname: "/p" }, 8443)).toBe("https://[fe80::1]:8443/p");
  });
});

describe("phone mic setting", () => {
  it("is remembered per seat, and storage failures are harmless", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(loadPhoneMic(storage, "pl_1")).toBe(false);
    savePhoneMic(storage, "pl_1", true);
    expect(m.get(phoneMicKey("pl_1"))).toBe("1");
    expect(loadPhoneMic(storage, "pl_1")).toBe(true);
    expect(loadPhoneMic(storage, "pl_2")).toBe(false);
    savePhoneMic(storage, "pl_1", false);
    expect(loadPhoneMic(storage, "pl_1")).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(loadPhoneMic(broken, "pl_1")).toBe(false);
    expect(() => savePhoneMic(broken, "pl_1", true)).not.toThrow();
    expect(loadPhoneMic(undefined, "pl_1")).toBe(false);
  });
});

describe("labels", () => {
  it("phone mic status: error, refusal, connecting, mic, ready", () => {
    expect(phoneMicStatus({ joined: true, hasMic: true, error: "Mic blocked" })).toBe("Mic blocked");
    expect(phoneMicStatus({ joined: false, hasMic: false, refused: "Pick a seat first." })).toBe("Pick a seat first.");
    expect(phoneMicStatus({ joined: false, hasMic: false })).toMatch(/Connecting/);
    expect(phoneMicStatus({ joined: true, hasMic: false })).toMatch(/microphone/);
    expect(phoneMicStatus({ joined: true, hasMic: true })).toMatch(/hold Talk/);
  });
  it("samples", () => {
    expect(samplesLabel(0)).toMatch(/doesn't know/);
    expect(samplesLabel(1)).toBe("Voice recorded (1 sample).");
    expect(samplesLabel(3)).toBe("Voice recorded (3 samples).");
  });
});
