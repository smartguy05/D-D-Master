import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCONNECT_GRACE_MS, VoiceLink, type PeerLike, type VoiceLinkState } from "./voice";

class FakePeer implements PeerLike {
  connectionState = "new";
  ontrack: PeerLike["ontrack"] = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  addTrack() {}
  createDataChannel() {}
  async createOffer() {
    return { sdp: "offer-sdp" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {
    this.closed = true;
  }
  set(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup() {
  const peers: FakePeer[] = [];
  const postOffer = vi.fn(async (_sdp: string, _resume: boolean) => "answer-sdp");
  const link = new VoiceLink({
    createPeer: () => {
      const p = new FakePeer();
      peers.push(p);
      return p;
    },
    postOffer,
    playRemote: () => undefined,
  });
  const states: VoiceLinkState[] = [];
  link.subscribe((s) => states.push(s));
  return { link, peers, postOffer, states };
}

describe("VoiceLink reconnect", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connects, then rebuilds the call with resume=1 when the peer fails", async () => {
    const { link, peers, postOffer, states } = setup();
    await link.start(stream);
    expect(postOffer).toHaveBeenCalledWith("offer-sdp", false);
    peers[0].set("connected");
    expect(link.state).toBe("connected");

    peers[0].set("failed");
    await flush();
    expect(states).toContain("reconnecting");
    expect(peers[0].closed).toBe(true);
    expect(peers).toHaveLength(2);
    expect(postOffer).toHaveBeenLastCalledWith("offer-sdp", true);
    peers[1].set("connected");
    expect(link.state).toBe("connected");
  });

  it("waits out a short 'disconnected' blip before reconnecting", async () => {
    const { link, peers } = setup();
    await link.start(stream);
    peers[0].set("connected");
    peers[0].set("disconnected");
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 1);
    peers[0].set("connected"); // recovered by itself
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(peers).toHaveLength(1);
    expect(link.state).toBe("connected");

    peers[0].set("disconnected");
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    await flush();
    expect(peers).toHaveLength(2);
    expect(link.state).toBe("reconnecting");
  });

  it("retries with backoff and reports failed when the server keeps refusing", async () => {
    const { link, peers, postOffer } = setup();
    await link.start(stream);
    postOffer.mockRejectedValue(new Error("OPENAI_API_KEY is not set."));
    peers[0].set("failed");
    await flush();
    expect(postOffer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(postOffer).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(postOffer).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(4000);
    expect(postOffer).toHaveBeenCalledTimes(5);
    expect(link.state).toBe("failed");
    expect(link.error).toContain("OPENAI_API_KEY");
  });

  it("manual reconnect works, and stop() cancels everything", async () => {
    const { link, peers, postOffer } = setup();
    await link.start(stream);
    await link.reconnect();
    expect(peers).toHaveLength(2);
    expect(postOffer).toHaveBeenLastCalledWith("offer-sdp", true);
    link.stop();
    expect(link.state).toBe("idle");
    expect(peers[1].closed).toBe(true);
    peers[1].set("failed"); // stale events are ignored
    await flush();
    expect(peers).toHaveLength(2);
    await link.reconnect(); // no stream after stop: no-op
    expect(peers).toHaveLength(2);
  });

  it("a failed first start throws and returns to idle", async () => {
    const { link, postOffer } = setup();
    postOffer.mockRejectedValueOnce(new Error("No campaign loaded."));
    await expect(link.start(stream)).rejects.toThrow("No campaign loaded.");
    expect(link.state).toBe("idle");
  });
});
