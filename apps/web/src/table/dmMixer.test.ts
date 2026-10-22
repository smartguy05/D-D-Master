import { describe, expect, it } from "vitest";
import { FLOOR_TAIL_MS, type FloorHolder, type FloorView } from "@dm/shared";
import { DmMixer, gainPlan, remoteTail, sendMixed, type MixerAudio } from "./dmMixer";

const floor = (holder: FloorHolder | null, pushToTalk = true): FloorView => ({ pushToTalk, holder });
const peers = [
  { peerId: "p2", playerId: "ana" },
  { peerId: "p3", playerId: "bo" },
];

describe("gainPlan (which remote voice reaches the DM)", () => {
  it("only the remote player holding the floor is heard", () => {
    expect(gainPlan({ floor: floor({ playerId: "ana", inRoom: false }), muted: false, peers, tail: null, now: 0 })).toEqual({ p2: 1, p3: 0 });
    expect(gainPlan({ floor: floor(null), muted: false, peers, tail: null, now: 0 })).toEqual({ p2: 0, p3: 0 });
    // The room (or a phone in the room) holding it: the room mic carries it, no remote voice.
    expect(gainPlan({ floor: floor({ room: true }), muted: false, peers, tail: null, now: 0 })).toEqual({ p2: 0, p3: 0 });
    expect(gainPlan({ floor: floor({ playerId: "bo", inRoom: true }), muted: false, peers, tail: null, now: 0 })).toEqual({ p2: 0, p3: 0 });
  });

  it("keeps the last holder audible for the tail after it lets go", () => {
    const tail = { playerId: "bo", until: 1000 };
    expect(gainPlan({ floor: floor(null), muted: false, peers, tail, now: 999 })).toEqual({ p2: 0, p3: 1 });
    expect(gainPlan({ floor: floor(null), muted: false, peers, tail, now: 1000 })).toEqual({ p2: 0, p3: 0 });
  });

  it("push-to-talk off is an open mic for everyone; the table mute silences everyone", () => {
    expect(gainPlan({ floor: floor(null, false), muted: false, peers, tail: null, now: 0 })).toEqual({ p2: 1, p3: 1 });
    expect(gainPlan({ floor: floor({ playerId: "ana", inRoom: false }), muted: true, peers, tail: null, now: 0 })).toEqual({ p2: 0, p3: 0 });
  });

  it("no floor yet (page load, /ws reconnect) is closed: a push-to-talk table never hears every remote mic", () => {
    expect(gainPlan({ floor: null, muted: false, peers, tail: null, now: 0 })).toEqual({ p2: 0, p3: 0 });
  });
});

describe("sendMixed (which stream the voice call sends)", () => {
  it("the mix only while a remote player is in the call and the mixer runs; else the room mic as before", () => {
    expect(sendMixed({ remotePlayers: 1, mixerRunning: true })).toBe(true);
    expect(sendMixed({ remotePlayers: 0, mixerRunning: true })).toBe(false);
    // Suspended (no click on the TV yet): the room mic still reaches the DM.
    expect(sendMixed({ remotePlayers: 2, mixerRunning: false })).toBe(false);
  });
});

describe("remoteTail", () => {
  it("starts when a remote holder lets go (or someone else takes over), else keeps the old one", () => {
    const ana: FloorHolder = { playerId: "ana", inRoom: false };
    expect(remoteTail(ana, null, 100, null)).toEqual({ playerId: "ana", until: 100 + FLOOR_TAIL_MS });
    expect(remoteTail(ana, { room: true }, 100, null)).toEqual({ playerId: "ana", until: 100 + FLOOR_TAIL_MS });
    expect(remoteTail(ana, ana, 100, null)).toBeNull();
    expect(remoteTail({ room: true }, null, 100, null)).toBeNull();
    expect(remoteTail({ playerId: "x", inRoom: true }, null, 100, null)).toBeNull();
    const old = { playerId: "bo", until: 50 };
    expect(remoteTail(null, null, 100, old)).toBe(old);
  });
});

/** A fake WebAudio graph: nodes record what they connect to. */
function fakeAudio() {
  const log: string[] = [];
  let n = 0;
  const node = (name: string) => ({
    name,
    gain: { value: 1, setTargetAtTime: (v: number) => void log.push(`${name}=${v}`) },
    connect: (to: { name: string }) => void log.push(`${name}->${to.name}`),
    disconnect: () => void log.push(`${name} x`),
  });
  const dest = { ...node("dest"), stream: { id: "mixed" } as unknown as MediaStream };
  const sinks: string[] = [];
  let contexts = 0;
  const audio: MixerAudio = {
    createContext: () => ({
      ...{ made: ++contexts },
      state: "running",
      currentTime: 0,
      destination: node("speakers"),
      createMediaStreamDestination: () => dest,
      createMediaStreamSource: (s: MediaStream) => node(`src:${(s as unknown as { id: string }).id}`),
      createGain: () => node(`gain${++n}`),
      resume: async () => undefined,
      close: async () => undefined,
    }) as never,
    attachSink: (s) => {
      sinks.push((s as unknown as { id: string }).id);
      return () => void sinks.splice(sinks.indexOf((s as unknown as { id: string }).id), 1);
    },
  };
  return { audio, log, sinks, dest, contexts: () => contexts };
}
const stream = (id: string) => ({ id }) as unknown as MediaStream;

describe("DmMixer (the stream the voice call sends)", () => {
  it("one output stream for the life of the page; sources come and go behind it", () => {
    const { audio, log, sinks } = fakeAudio();
    const mixer = new DmMixer(audio);
    const out = mixer.stream;
    mixer.setRoom(stream("room"));
    mixer.setPeer("p2", "ana", stream("ana"));
    expect(mixer.stream).toBe(out);
    expect(log).toContain("src:room->dest");
    // A remote track feeds WebAudio only while a (muted) media element plays it (Chrome).
    expect(sinks).toEqual(["ana"]);
    expect(log.some((l) => /src:ana->gain\d/.test(l))).toBe(true);
    mixer.setPeer("p2", "ana", null);
    expect(sinks).toEqual([]);
    expect(log).toContain("src:ana x");
    mixer.setPeer("p3", "bo", stream("bo"));
    mixer.setPeer("p4", "cy", stream("cy"));
    mixer.retain(["p4"]);
    expect(sinks).toEqual(["cy"]);
    mixer.setRoom(null);
    expect(log).toContain("src:room x");
    expect(mixer.stream).toBe(out);
  });

  it("makes no audio context for the room mic alone; the first remote voice builds the graph with the room in it", () => {
    const { audio, log, contexts } = fakeAudio();
    const mixer = new DmMixer(audio);
    mixer.setRoom(stream("room"));
    expect(contexts()).toBe(0);
    expect(mixer.running).toBe(false);
    mixer.setPeer("p2", "ana", stream("ana"));
    expect(contexts()).toBe(1);
    expect(log).toContain("src:room->dest");
    expect(mixer.running).toBe(true);
  });

  it("a remote voice stays silent until the floor arrives, then opens if push-to-talk is off", () => {
    const { audio, log } = fakeAudio();
    const mixer = new DmMixer(audio);
    mixer.setPeer("p2", "ana", stream("ana"));
    const gainName = log.find((l) => /^src:ana->gain\d$/.test(l))!.split("->")[1];
    expect(log.at(-1)).toBe(`${gainName}=0`);
    mixer.applyFloor(null, false, 0);
    expect(log.at(-1)).toBe(`${gainName}=0`);
    mixer.applyFloor(floor(null, false), false, 10);
    expect(log.at(-1)).toBe(`${gainName}=1`);
  });

  it("applies the floor to the remote gains, with the tail, and says when to look again", () => {
    const { audio, log } = fakeAudio();
    const mixer = new DmMixer(audio);
    mixer.setPeer("p2", "ana", stream("ana"));
    const gainName = log.find((l) => /^src:ana->gain\d$/.test(l))!.split("->")[1];
    expect(mixer.applyFloor(floor({ playerId: "ana", inRoom: false }), false, 0)).toBe(0);
    expect(log.at(-1)).toBe(`${gainName}=1`);
    const recheck = mixer.applyFloor(floor(null), false, 1000);
    expect(recheck).toBe(FLOOR_TAIL_MS);
    expect(log.at(-1)).toBe(`${gainName}=1`);
    mixer.applyFloor(floor(null), false, 1000 + FLOOR_TAIL_MS);
    expect(log.at(-1)).toBe(`${gainName}=0`);
    // A peer that joins later starts at the current plan (silent here).
    mixer.setPeer("p3", "bo", stream("bo"));
    expect(log.at(-1)).toMatch(/=0$/);
  });
});
