import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipDurationMs, estimateSpeechMs, mp3DurationMs, NpcVoice, pickNpcVoice, speakAsNpc, type SpeechClient } from "./npc-voice.js";
import { NpcClipQueue, RESERVE_MAX_MS, type NpcClip } from "./npc-queue.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(withClient = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "npcvoice-"));
  dirs.push(dataDir);
  const create = vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  const client: SpeechClient = { audio: { speech: { create } } };
  const voice = new NpcVoice(withClient ? client : undefined, { model: "gpt-4o-mini-tts", dmVoice: "cedar", dataDir, urlPrefix: "/media" });
  const events: NpcClip[] = [];
  const logs: [string, string][] = [];
  const ctx = {
    campaignId: "cmp_1",
    npcs: [{ name: "Sister Maren", description: "", motive: "", voice: "breathy whisper, long pauses" }],
    voice,
    reserve: () => ({ play: (clip: NpcClip) => (events.push(clip), true), cancel: () => undefined, done: Promise.resolve() }),
    log: (speaker: string, text: string) => logs.push([speaker, text]),
  };
  return { dataDir, create, voice, events, logs, ctx };
}

describe("speak_as_npc", () => {
  it("synthesizes the line with the NPC's voice direction, saves an mp3 and queues it to play", async () => {
    const { create, events, logs, ctx, dataDir } = setup();
    const out = await speakAsNpc({ npc_name: "sister maren", line: "Leave this place.", style: "terrified" }, ctx);
    expect(out.ok).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    const params = (create.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(params).toMatchObject({ model: "gpt-4o-mini-tts", input: "Leave this place.", response_format: "mp3", instructions: "breathy whisper, long pauses. terrified" });
    expect(params.voice).not.toBe("cedar");
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev).toMatchObject({ npcName: "Sister Maren", line: "Leave this place." });
    // Not a parseable mp3: falls back to the text estimate.
    expect(ev.durationMs).toBe(estimateSpeechMs("Leave this place."));
    expect(out.playing).toMatch(/after you stop talking/i);
    expect(ev.url).toMatch(/^\/media\/cmp_1\/npc_[0-9a-f]{12}\.mp3$/);
    const file = join(dataDir, "cmp_1", "assets", ev.url.split("/").pop()!);
    expect(existsSync(file)).toBe(true);
    expect([...readFileSync(file)]).toEqual([1, 2, 3]);
    expect(logs).toEqual([["Sister Maren", "Leave this place."]]);
  });

  it("reuses the cached file for the same line", async () => {
    const { create, ctx } = setup();
    await speakAsNpc({ npc_name: "Sister Maren", line: "Again." }, ctx);
    await speakAsNpc({ npc_name: "Sister Maren", line: "Again." }, ctx);
    expect(create).toHaveBeenCalledOnce();
  });

  it("validates arguments", async () => {
    const { ctx, create } = setup();
    await expect(speakAsNpc({ npc_name: "Maren", line: "" }, ctx)).rejects.toThrow();
    await expect(speakAsNpc({ npc_name: "Maren", line: "x".repeat(401) }, ctx)).rejects.toThrow();
    await expect(speakAsNpc({ line: "Hi" }, ctx)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an error to the DM when NPC voices are off", async () => {
    const { ctx, events } = setup(false);
    const out = await speakAsNpc({ npc_name: "Maren", line: "Hi" }, ctx);
    expect(out).toMatchObject({ ok: false });
    expect(events).toEqual([]);
  });

  it("reads the clip length from the mp3 frames", async () => {
    const { ctx, create, events } = setup();
    // 2 s of 128 kbps CBR MPEG-1 Layer III (44.1 kHz): 32000 bytes of frames after a 20-byte ID3 tag.
    create.mockImplementationOnce(async () => ({ arrayBuffer: async () => cbrMp3(2000, 128, 20).buffer as ArrayBuffer }));
    await speakAsNpc({ npc_name: "Sister Maren", line: "A much longer line than two seconds would allow." }, ctx);
    expect(events[0].durationMs).toBe(2000);
  });

  it("gives improvised NPCs a stable voice that is never the DM's", () => {
    expect(pickNpcVoice("Innkeeper Bram", "cedar")).toBe(pickNpcVoice(" innkeeper bram ", "cedar"));
    for (const n of ["a", "b", "c", "d", "e", "f", "g", "h"]) expect(pickNpcVoice(n, "cedar")).not.toBe("cedar");
  });
});

/** Fake CBR mp3: optional ID3v2 tag, then one MPEG-1 Layer III frame header padded to the byte size. */
function cbrMp3(ms: number, kbps: number, id3Payload = 0) {
  const frames = (ms / 1000) * kbps * 125;
  const id3 = id3Payload ? 10 + id3Payload : 0;
  const buf = new Uint8Array(id3 + frames);
  if (id3Payload) {
    buf.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, id3Payload], 0);
  }
  const bitrateIndex = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320].indexOf(kbps);
  buf.set([0xff, 0xfb, (bitrateIndex << 4) | 0x00, 0xc4], id3);
  return buf;
}

describe("speak_as_npc ordering and clip length", () => {
  it("parallel calls in one response play in call order, not synthesis order", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "npcord-"));
    dirs.push(dataDir);
    // The first line takes longer to synthesize.
    const client: SpeechClient = {
      audio: {
        speech: {
          create: (async (p: { input: string }) => {
            await new Promise((r) => setTimeout(r, p.input.startsWith("First") ? 30 : 1));
            return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
          }) as any,
        },
      },
    };
    const voice = new NpcVoice(client, { model: "m", dmVoice: "cedar", dataDir, urlPrefix: "/media" });
    const broadcast: string[] = [];
    const queue = new NpcClipQueue({ broadcast: (ev) => void broadcast.push((ev as { npcName: string }).npcName) });
    const ctx = { campaignId: "c", npcs: [], voice, reserve: () => queue.reserve(), log: () => undefined };
    // DmSession.onResponseDone runs every function call with Promise.all.
    await Promise.all([speakAsNpc({ npc_name: "Guard", line: "First: halt, who goes there?" }, ctx), speakAsNpc({ npc_name: "Thief", line: "Second: run!" }, ctx)]);
    expect(broadcast).toEqual(["Guard"]);
    queue.clipEnded(`/media/c/${"x"}`); // wrong url: nothing
    const guardUrl = (queue as any).queue[0].clip.url as string;
    queue.clipEnded(guardUrl);
    expect(broadcast).toEqual(["Guard", "Thief"]);
    queue.clear();
  });

  it("frees the reserved slot when synthesis fails", async () => {
    const { ctx, create } = setup();
    const cancel = vi.fn();
    const play = vi.fn();
    create.mockRejectedValueOnce(new Error("TTS down"));
    await expect(speakAsNpc({ npc_name: "Maren", line: "Hi" }, { ...ctx, reserve: () => ({ play, cancel, done: Promise.resolve() }) })).rejects.toThrow("TTS down");
    expect(cancel).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it("falls back to the text estimate when the mp3 claims an absurd length", async () => {
    const { ctx, create, events } = setup();
    // Xing header claiming 10 000 frames (~4 min) for a two-word line.
    const buf = cbrMp3(1000, 128);
    buf.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0, 0, 0x27, 0x10], 21);
    create.mockImplementationOnce(async () => ({ arrayBuffer: async () => buf.buffer as ArrayBuffer }));
    await speakAsNpc({ npc_name: "Maren", line: "Go away." }, ctx);
    expect(events[0].durationMs).toBe(estimateSpeechMs("Go away."));
  });
});

describe("mp3DurationMs", () => {
  it("skips an ID3v2 tag, even one with a fake frame sync or longer than the scan window", () => {
    // A fake 32 kbps frame header inside the tag must not be read.
    const fake = cbrMp3(1000, 128, 50);
    fake.set([0xff, 0xfb, 0x10, 0xc4], 20);
    expect(mp3DurationMs(fake)).toBe(1000);
    // 6000-byte tag (syncsafe size 6000 = 0x2e 0x70 in 7-bit groups).
    const big = new Uint8Array(10 + 6000 + 16000);
    big.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x2e, 0x70], 0);
    big.set([0xff, 0xfb, 0x90, 0xc4], 10 + 6000);
    expect(mp3DurationMs(big)).toBe(1000);
  });

  it("ignores a corrupt Xing frame count and uses the bitrate", () => {
    const buf = new Uint8Array(2000);
    buf.set([0xff, 0xfb, 0x90, 0x00], 0); // 128 kbps, stereo
    buf.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff], 4 + 32);
    expect(mp3DurationMs(buf)).toBe(125);
  });

  it("computes CBR duration from the first frame's bitrate", () => {
    expect(mp3DurationMs(cbrMp3(3000, 64))).toBe(3000);
    expect(mp3DurationMs(cbrMp3(1500, 128, 100))).toBe(1500);
  });

  it("uses the Xing/Info frame count when present", () => {
    const buf = cbrMp3(1000, 128);
    // MPEG-1 mono (channel mode 3): side info is 17 bytes, so the tag starts at 4 + 17.
    buf[3] = 0xc4;
    buf.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0, 0, 0, 100], 21);
    // 100 frames x 1152 samples / 44100 Hz = 2612 ms
    expect(mp3DurationMs(buf)).toBe(Math.round((100 * 1152 * 1000) / 44100));
  });

  it("returns undefined for data that isn't an mp3", () => {
    expect(mp3DurationMs(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(mp3DurationMs(new Uint8Array(0))).toBeUndefined();
  });
});

describe("speak_as_npc with synthesis slower than the slot reservation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tells the DM to speak the line itself and doesn't log it as spoken", async () => {
    const events: unknown[] = [];
    const logs: string[] = [];
    const queue = new NpcClipQueue({ broadcast: (ev) => void events.push(ev) });
    const voice = {
      available: true,
      synthesize: () => new Promise((r) => setTimeout(() => r({ url: "/media/c/npc_slow.mp3", durationMs: 2000 }), RESERVE_MAX_MS + 5000)),
    } as unknown as NpcVoice;
    const out = speakAsNpc({ npc_name: "Bram", line: "Who goes there?" }, { campaignId: "c", npcs: [], voice, reserve: () => queue.reserve(), log: (_s, t) => void logs.push(t) });
    await vi.advanceTimersByTimeAsync(RESERVE_MAX_MS + 5000);
    expect(await out).toEqual({ ok: false, error: "NPC voice was too slow; speak the line yourself" });
    expect(events).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe("clipDurationMs", () => {
  it("trusts a parsed length up to 8 s, even for a short slow line", () => {
    expect(clipDurationMs(3500, "Leave.")).toBe(3500);
    expect(clipDurationMs(8000, "Leave.")).toBe(8000);
  });

  it("above 8 s, falls back to the text estimate when over 3x it", () => {
    expect(clipDurationMs(9000, "Leave.")).toBe(estimateSpeechMs("Leave."));
    const line = "x".repeat(60); // 4 s estimate, 3x = 12 s
    expect(clipDurationMs(11_000, line)).toBe(11_000);
    expect(clipDurationMs(13_000, line)).toBe(estimateSpeechMs(line));
  });

  it("never trusts more than 60 s, or a missing/zero length", () => {
    const line = "x".repeat(400); // ~26.7 s estimate
    expect(clipDurationMs(59_000, line)).toBe(59_000);
    expect(clipDurationMs(61_000, line)).toBe(estimateSpeechMs(line));
    expect(clipDurationMs(undefined, "Hi")).toBe(estimateSpeechMs("Hi"));
    expect(clipDurationMs(0, "Hi")).toBe(estimateSpeechMs("Hi"));
  });
});
