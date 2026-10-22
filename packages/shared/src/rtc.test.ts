import { describe, expect, it } from "vitest";
import { peerPrefs, rtcSignal, RTC_SIGNAL_MAX_CHARS } from "./rtc.js";

describe("rtcSignal (WebRTC signaling payload check)", () => {
  it("keeps an offer, an answer and a rollback, nothing else", () => {
    expect(rtcSignal({ description: { type: "offer", sdp: "v=0\r\n" } })).toEqual({ description: { type: "offer", sdp: "v=0\r\n" } });
    expect(rtcSignal({ description: { type: "answer", sdp: "v=0", extra: 1 } })).toEqual({ description: { type: "answer", sdp: "v=0" } });
    expect(rtcSignal({ description: { type: "rollback" } })).toEqual({ description: { type: "rollback" } });
    expect(rtcSignal({ description: { type: "pranswer", sdp: "x" } })).toBeUndefined();
    expect(rtcSignal({ description: { type: "offer" } })).toBeUndefined();
    expect(rtcSignal({ description: { type: "offer", sdp: 5 } })).toBeUndefined();
  });

  it("keeps an ICE candidate's known fields, and the end-of-candidates null", () => {
    const c = { candidate: "candidate:1 1 udp 2122260223 192.168.1.2 54400 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "abcd", junk: { a: 1 } };
    expect(rtcSignal({ candidate: c })).toEqual({ candidate: { candidate: c.candidate, sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "abcd" } });
    expect(rtcSignal({ candidate: null })).toEqual({ candidate: null });
    expect(rtcSignal({ candidate: { candidate: 3 } })).toBeUndefined();
    expect(rtcSignal({ candidate: { candidate: "x", sdpMLineIndex: "0" } })).toBeUndefined();
  });

  it("refuses garbage and oversized payloads", () => {
    expect(rtcSignal(undefined)).toBeUndefined();
    expect(rtcSignal("offer")).toBeUndefined();
    expect(rtcSignal({})).toBeUndefined();
    expect(rtcSignal({ description: { type: "offer", sdp: "x".repeat(RTC_SIGNAL_MAX_CHARS + 1) } })).toBeUndefined();
    expect(rtcSignal({ candidate: { candidate: "x".repeat(2000) } })).toBeUndefined();
  });
});

describe("peerPrefs", () => {
  it("reads booleans and defaults the rest", () => {
    expect(peerPrefs({ camera: true, showCharacter: false, micOn: false })).toEqual({ camera: true, showCharacter: false, micOn: false });
    expect(peerPrefs({ camera: "yes" })).toEqual({ camera: false, showCharacter: false, micOn: true });
    expect(peerPrefs(null)).toEqual({ camera: false, showCharacter: false, micOn: true });
  });
});
