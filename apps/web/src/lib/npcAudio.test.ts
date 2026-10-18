import { describe, expect, it, vi } from "vitest";
import { NpcClipPlayer, type ClipAudio } from "./npcAudio";

class FakeAudio implements ClipAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  constructor(
    readonly url: string,
    private playResult: Promise<void> = Promise.resolve(),
  ) {}
  play() {
    return this.playResult;
  }
  pause() {
    this.paused = true;
  }
}

function setup(opts: { muted?: boolean; failPlay?: boolean } = {}) {
  const audios: FakeAudio[] = [];
  const reported: string[] = [];
  let muted = opts.muted ?? false;
  const player = new NpcClipPlayer({
    createAudio: (url) => {
      const a = new FakeAudio(url, opts.failPlay ? Promise.reject(new Error("autoplay blocked")) : Promise.resolve());
      audios.push(a);
      return a;
    },
    isMuted: () => muted,
    reportEnded: (url) => void reported.push(url),
  });
  return { player, audios, reported, setMuted: (m: boolean) => (muted = m) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("NpcClipPlayer", () => {
  it("plays clips one after another and reports each end", async () => {
    const { player, audios, reported } = setup();
    player.enqueue("/a.mp3");
    player.enqueue("/b.mp3");
    expect(audios.map((a) => a.url)).toEqual(["/a.mp3"]);
    audios[0].onended?.();
    expect(reported).toEqual(["/a.mp3"]);
    expect(audios.map((a) => a.url)).toEqual(["/a.mp3", "/b.mp3"]);
    audios[1].onended?.();
    expect(reported).toEqual(["/a.mp3", "/b.mp3"]);
    await flush();
  });

  it("a muted table neither plays nor reports (the server's clip timeout releases the DM)", () => {
    const { player, audios, reported } = setup({ muted: true });
    player.enqueue("/a.mp3");
    player.enqueue("/b.mp3");
    expect(audios).toHaveLength(0);
    expect(reported).toEqual([]);
  });

  it("reports an error or a blocked play() as ended and moves on", async () => {
    const blocked = setup({ failPlay: true });
    blocked.player.enqueue("/a.mp3");
    blocked.player.enqueue("/b.mp3");
    await flush();
    await flush();
    expect(blocked.reported).toEqual(["/a.mp3", "/b.mp3"]);

    const broken = setup();
    broken.player.enqueue("/c.mp3");
    broken.player.enqueue("/d.mp3");
    broken.audios[0].onerror!();
    expect(broken.reported).toEqual(["/c.mp3"]);
    expect(broken.audios.map((a) => a.url)).toEqual(["/c.mp3", "/d.mp3"]);
    // ended after error is not reported twice
    broken.audios[0].onended?.();
    expect(broken.reported).toEqual(["/c.mp3"]);
  });

  it("muting mid-clip stops it and drops the rest without reporting", () => {
    const { player, audios, reported, setMuted } = setup();
    player.enqueue("/a.mp3");
    player.enqueue("/b.mp3");
    setMuted(true);
    player.onMute();
    expect(audios[0].paused).toBe(true);
    audios[0].onended?.();
    expect(reported).toEqual([]);
    expect(audios).toHaveLength(1);
    // Unmuted again: new clips play and report as usual.
    setMuted(false);
    player.enqueue("/c.mp3");
    audios[1].onended?.();
    expect(reported).toEqual(["/c.mp3"]);
  });

  it("ignores a duplicate enqueue of the clip already playing or waiting", () => {
    const { player, audios } = setup();
    player.enqueue("/a.mp3");
    player.enqueue("/a.mp3");
    audios[0].onended?.();
    expect(audios).toHaveLength(1);
  });

  it("stop() drops everything without reporting", () => {
    const report = vi.fn();
    const audios: FakeAudio[] = [];
    const p = new NpcClipPlayer({ createAudio: (u) => (audios.push(new FakeAudio(u)), audios.at(-1)!), isMuted: () => false, reportEnded: report });
    p.enqueue("/a.mp3");
    p.enqueue("/b.mp3");
    p.stop();
    expect(audios[0].paused).toBe(true);
    audios[0].onended?.();
    expect(audios).toHaveLength(1);
    expect(report).not.toHaveBeenCalled();
  });
});
