import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioSocketUrl, DISCONNECT_GRACE_MS, MIC_RECONNECT_DELAYS_MS, MicStreamer, VoiceLink, type OfferMode, type PeerLike, type SenderLike, type SocketLike, type VoiceLinkState } from "./voice";

class FakeSender implements SenderLike {
  track: MediaStreamTrack | null;
  history: (MediaStreamTrack | null)[] = [];
  constructor(track: MediaStreamTrack) {
    this.track = track;
  }
  async replaceTrack(t: MediaStreamTrack | null) {
    this.track = t;
    this.history.push(t);
  }
}

class FakePeer implements PeerLike {
  connectionState = "new";
  ontrack: PeerLike["ontrack"] = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  senders: FakeSender[] = [];
  addTrack(track: MediaStreamTrack) {
    const s = new FakeSender(track);
    this.senders.push(s);
    return s;
  }
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

const micTrack = { kind: "audio", id: "mic" } as unknown as MediaStreamTrack;
const stream = { getAudioTracks: () => [micTrack] } as unknown as MediaStream;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup() {
  const peers: FakePeer[] = [];
  const postOffer = vi.fn(async (_sdp: string, _mode: OfferMode) => "answer-sdp");
  const played: (MediaStream | null)[] = [];
  const link = new VoiceLink({
    createPeer: () => {
      const p = new FakePeer();
      peers.push(p);
      return p;
    },
    postOffer,
    playRemote: (s) => void played.push(s),
  });
  const states: VoiceLinkState[] = [];
  link.subscribe((s) => states.push(s));
  return { link, peers, postOffer, states, played };
}

describe("VoiceLink reconnect", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connects, then rebuilds the call with resume=1 when the peer fails", async () => {
    const { link, peers, postOffer, states } = setup();
    await link.start(stream);
    expect(postOffer).toHaveBeenCalledWith("offer-sdp", "start");
    peers[0].set("connected");
    expect(link.state).toBe("connected");

    peers[0].set("failed");
    await flush();
    expect(states).toContain("reconnecting");
    expect(peers[0].closed).toBe(true);
    expect(peers).toHaveLength(2);
    expect(postOffer).toHaveBeenLastCalledWith("offer-sdp", "resume");
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
    expect(postOffer).toHaveBeenLastCalledWith("offer-sdp", "resume");
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

describe("VoiceLink.resume (a reloaded /table joins the running DM)", () => {
  it("builds a call with resume=1 and reports reconnecting until it is up", async () => {
    const { link, peers, postOffer, states } = setup();
    await link.resume(stream);
    expect(postOffer).toHaveBeenCalledWith("offer-sdp", "resume");
    expect(states).toEqual(["reconnecting"]);
    expect(link.active).toBe(true);
    peers[0].set("connected");
    expect(link.state).toBe("connected");
  });

  it("a refused resume throws and returns to idle", async () => {
    const { link, postOffer } = setup();
    postOffer.mockRejectedValueOnce(new Error("No campaign loaded"));
    await expect(link.resume(stream)).rejects.toThrow("No campaign loaded");
    expect(link.state).toBe("idle");
    expect(link.active).toBe(false);
  });
});

describe("audioSocketUrl", () => {
  it("names the streaming page's role", () => {
    expect(audioSocketUrl("table", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws/audio?role=table");
    expect(audioSocketUrl("host", { protocol: "https:", host: "laptop:8788" })).toBe("wss://laptop:8788/ws/audio?role=host");
    expect(audioSocketUrl("player", { protocol: "https:", host: "pc:8443" }, "pl 1")).toBe("wss://pc:8443/ws/audio?role=player&player=pl%201");
  });
});

describe("VoiceLink planned handover", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const remoteA = { id: "a" } as unknown as MediaStream;
  const remoteB = { id: "b" } as unknown as MediaStream;

  async function live() {
    const t = setup();
    await t.link.start(stream);
    t.peers[0].set("connected");
    t.peers[0].ontrack?.({ streams: [remoteA] });
    return t;
  }

  it("prepares a muted, silent standby, then swaps to it and closes the old call", async () => {
    const { link, peers, postOffer, states, played } = await live();
    const statesBefore = states.length;
    expect(await link.prepareHandover()).toBe(true);
    expect(postOffer).toHaveBeenLastCalledWith("offer-sdp", "handover");
    expect(peers).toHaveLength(2);
    const standby = peers[1];
    expect(standby.senders[0].track).toBeNull(); // the new call hears nothing yet
    standby.ontrack?.({ streams: [remoteB] });
    standby.set("connected");
    expect(played.at(-1)).toBe(remoteA); // still playing the old call
    expect(peers[0].closed).toBe(false);

    expect(await link.commitHandover()).toBe(true);
    expect(standby.senders[0].track).toBe(micTrack); // mic back on the new call
    expect(played.at(-1)).toBe(remoteB);
    expect(peers[0].closed).toBe(true);
    expect(link.state).toBe("connected");
    expect(states.length).toBe(statesBefore); // silent: no status change
    expect(link.handoverPending).toBe(false);

    // The new peer is now the current one: its failure triggers the usual resume reconnect.
    peers[0].set("failed"); // the old peer is ignored
    await flush();
    expect(peers).toHaveLength(2);
    standby.set("failed");
    await flush();
    expect(peers).toHaveLength(3);
    expect(postOffer).toHaveBeenLastCalledWith("offer-sdp", "resume");
  });

  it("tells listeners which stream the DM's voice is on (forwarded to remote players): live call, swap, stop", async () => {
    const { link, peers } = await live();
    const seen: (MediaStream | null)[] = [];
    const off = link.onRemoteStream((s) => seen.push(s));
    expect(link.remoteStream).toBe(remoteA);
    await link.prepareHandover();
    peers[1].ontrack?.({ streams: [remoteB] });
    expect(seen).toEqual([]); // the standby's audio is held until the swap
    await link.commitHandover();
    expect(seen).toEqual([remoteB]);
    link.stop();
    expect(seen).toEqual([remoteB, null]);
    expect(link.remoteStream).toBeNull();
    off();
  });

  it("a reconnect sends the same stream's track again (the DM mixer's output survives)", async () => {
    const { link, peers } = await live();
    peers[0].set("failed");
    await flush();
    expect(peers[1].senders.map((s) => s.track)).toEqual([micTrack]);
  });

  it("replaceStream swaps the track the DM hears on the live call, a reconnect and a pending standby", async () => {
    const { link, peers } = await live();
    const mixed = { kind: "audio", id: "mixed" } as unknown as MediaStreamTrack;
    const mixedStream = { getAudioTracks: () => [mixed] } as unknown as MediaStream;
    link.replaceStream(mixedStream);
    await flush();
    expect(peers[0].senders[0].track).toBe(mixed);
    // A standby built now starts muted and unmutes with the stream that is current at the swap.
    await link.prepareHandover();
    link.replaceStream(stream);
    await flush();
    expect(peers[1].senders[0].track).toBeNull();
    await link.commitHandover();
    expect(peers[1].senders[0].track).toBe(micTrack);
    // The swapped-in call is now the live one: the next replace reaches it.
    link.replaceStream(mixedStream);
    await flush();
    expect(peers[1].senders[0].track).toBe(mixed);
    peers[1].set("failed");
    await flush();
    expect(peers[2].senders[0].track).toBe(mixed);
  });

  // useTableVoice swaps mic <-> mixer whenever a remote player joins/leaves; a swap can land while
  // commitHandover is unmuting the standby, after it is no longer `standby` but before it is live.
  it("a replaceStream during the swap's unmute still reaches the new call", async () => {
    const { link, peers } = await live();
    await link.prepareHandover();
    const sender = peers[1].senders[0];
    let unmuted!: () => void;
    sender.replaceTrack = (t) => {
      sender.track = t;
      return new Promise<void>((r) => (unmuted = r));
    };
    const commit = link.commitHandover();
    await flush();
    const mixed = { kind: "audio", id: "mixed" } as unknown as MediaStreamTrack;
    link.replaceStream({ getAudioTracks: () => [mixed] } as unknown as MediaStream);
    unmuted();
    expect(await commit).toBe(true);
    await flush();
    expect(sender.track).toBe(mixed);
  });

  it("replaceStream does nothing without a call", () => {
    const { link, peers } = setup();
    link.replaceStream(stream);
    expect(peers).toHaveLength(0);
    expect(link.active).toBe(false);
  });

  it("commit waits for a standby still being answered", async () => {
    const { link, peers, postOffer } = await live();
    let answer!: (sdp: string) => void;
    postOffer.mockImplementationOnce(() => new Promise<string>((r) => (answer = r)));
    const prep = link.prepareHandover();
    await flush();
    const commit = link.commitHandover();
    answer("answer-sdp");
    expect(await prep).toBe(true);
    expect(await commit).toBe(true);
    expect(peers[0].closed).toBe(true);
  });

  it("abort drops the standby and keeps the live call", async () => {
    const { link, peers, played } = await live();
    await link.prepareHandover();
    link.abortHandover();
    expect(peers[1].closed).toBe(true);
    expect(peers[0].closed).toBe(false);
    expect(await link.commitHandover()).toBe(false);
    expect(played.at(-1)).toBe(remoteA);
    expect(link.state).toBe("connected");
  });

  it("a failed standby offer leaves the live call alone", async () => {
    const { link, peers, postOffer } = await live();
    postOffer.mockRejectedValueOnce(new Error("handover refused"));
    expect(await link.prepareHandover()).toBe(false);
    expect(peers[1].closed).toBe(true);
    expect(peers[0].closed).toBe(false);
    expect(link.handoverPending).toBe(false);
  });

  it("a reconnect or stop during a pending handover cancels the standby", async () => {
    const t = await live();
    let answer!: (sdp: string) => void;
    t.postOffer.mockImplementationOnce(() => new Promise<string>((r) => (answer = r)));
    const prep = t.link.prepareHandover();
    await flush();
    t.peers[0].set("failed"); // the live call drops: reconnect wins
    await flush();
    expect(t.peers[1].closed).toBe(true);
    answer("answer-sdp");
    expect(await prep).toBe(false);
    expect(await t.link.commitHandover()).toBe(false);

    const u = await live();
    const p2 = u.link.prepareHandover();
    u.link.stop();
    expect(await p2).toBe(false);
    expect(u.peers[1].closed).toBe(true);
  });

  it("does nothing without a live call", async () => {
    const { link, peers } = setup();
    expect(await link.prepareHandover()).toBe(false);
    expect(peers).toHaveLength(0);
  });
});

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: ArrayBuffer[] = [];
  closed = false;
  send(d: ArrayBuffer) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("MicStreamer socket", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function mic() {
    const sockets: FakeSocket[] = [];
    const streamer = new MicStreamer("table", {
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    const changes: boolean[] = [];
    streamer.onChange((c) => changes.push(c));
    return { streamer, sockets, changes };
  }

  it("reopens a dropped socket with backoff and reports up/down", () => {
    const { streamer, sockets, changes } = mic();
    streamer.openSocket();
    sockets[0].open();
    expect(streamer.connected).toBe(true);
    expect(sockets[0].binaryType).toBe("arraybuffer");
    streamer.send(new ArrayBuffer(2));
    expect(sockets[0].sent).toHaveLength(1);

    sockets[0].drop();
    expect(streamer.connected).toBe(false);
    streamer.send(new ArrayBuffer(2)); // dropped while down
    vi.advanceTimersByTime(MIC_RECONNECT_DELAYS_MS[0] - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    // server still down: the waits grow 2 s, 4 s, then stay at 5 s
    sockets[1].drop();
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(3);
    sockets[2].drop();
    vi.advanceTimersByTime(4000);
    expect(sockets).toHaveLength(4);
    sockets[3].drop();
    vi.advanceTimersByTime(5000);
    sockets[4].drop();
    vi.advanceTimersByTime(5000);
    expect(sockets).toHaveLength(6);
    sockets[5].open();
    expect(streamer.connected).toBe(true);
    expect(changes).toEqual([true, false, false, false, false, false, true]);
    // a successful open resets the backoff
    sockets[5].drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(7);
  });

  it("stop() closes the socket and prevents any reconnect", () => {
    const { streamer, sockets } = mic();
    streamer.openSocket();
    sockets[0].open();
    sockets[0].drop();
    streamer.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    const b = mic();
    b.streamer.openSocket();
    b.sockets[0].open();
    b.streamer.stop();
    expect(b.sockets[0].closed).toBe(true);
    expect(b.streamer.connected).toBe(false);
    b.sockets[0].drop(); // a late close event does nothing
    vi.advanceTimersByTime(60_000);
    expect(b.sockets).toHaveLength(1);
    b.streamer.openSocket(); // no-op after stop
    expect(b.sockets).toHaveLength(1);
  });
});
