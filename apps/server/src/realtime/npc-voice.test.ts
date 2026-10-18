import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateSpeechMs, mp3DurationMs, NpcVoice, pickNpcVoice, speakAsNpc, type SpeechClient } from "./npc-voice.js";
import type { NpcClip } from "./npc-queue.js";

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
    play: (clip: NpcClip) => void events.push(clip),
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

describe("mp3DurationMs", () => {
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
