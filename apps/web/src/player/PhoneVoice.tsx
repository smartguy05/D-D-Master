import { useEffect, useRef, useState } from "react";
import type { FloorView } from "@dm/shared";
import { api } from "../lib/api";
import { getTableMic, MicStreamer } from "../lib/voice";
import { micFailure } from "../call/mediaErrors";
import { useCall } from "../call/useCall";
import type { ServerView } from "../lib/useServer";
import { micAllowed, phoneMicStatus, samplesLabel, secureUrl } from "./phoneVoice";

/** How long the phone's audio socket may take to open before a recording gives up. */
const SOCKET_WAIT_MS = 5000;

function connected(streamer: MicStreamer): Promise<void> {
  if (streamer.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error("Couldn't reach the server's audio socket."));
    }, SOCKET_WAIT_MS);
    const off = streamer.onChange((up) => {
      if (!up) return;
      clearTimeout(t);
      off();
      resolve();
    });
  });
}

/**
 * "Your voice" on an in-room phone (docs/web/player-view.md#your-voice-on-the-phone): record this
 * player's voiceprint on the phone (its own /ws/audio?role=player stream; the server merges it into
 * the same voiceprint as a /host recording), and use the phone as their mic toward the DM (PhoneMicCall).
 * Browsers only allow the mic on https: an http page links to itself on the server's HTTPS port.
 */
export function PhoneVoice({ playerId, samples, view, phoneMic, setPhoneMic }: { playerId: string; samples: number; view: ServerView; phoneMic: boolean; setPhoneMic: (on: boolean) => void }) {
  const [httpsPort, setHttpsPort] = useState<number>();
  useEffect(() => {
    let live = true;
    api<{ httpsPort?: number }>("/player-urls")
      .then((r) => live && setHttpsPort(r.httpsPort))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const rec = useRef<{ stream: MediaStream; streamer: MicStreamer } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [level, setLevel] = useState(0);

  const stopLocal = () => {
    rec.current?.streamer.stop();
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setRecording(false);
    setLevel(0);
  };
  // Leaving the page mid-recording ends it (the server's cap would otherwise keep it running).
  useEffect(
    () => () => {
      if (!rec.current) return;
      void api(`/players/${playerId}/voice/stop`, {}).catch(() => undefined);
      stopLocal();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playerId],
  );
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setLevel(rec.current?.streamer.level ?? 0), 120);
    return () => clearInterval(t);
  }, [recording]);
  // Another device (or /host) finished this seat's recording: show its result.
  const last = view.lastEnroll?.playerId === playerId ? view.lastEnroll : undefined;
  useEffect(() => {
    if (last) setMsg(last.message);
  }, [last]);

  const start = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      let stream: MediaStream;
      try {
        stream = await getTableMic();
      } catch (err) {
        throw new Error(micFailure(err));
      }
      const streamer = new MicStreamer("player", {}, playerId);
      rec.current = { stream, streamer };
      await streamer.start(stream);
      await connected(streamer);
      await api(`/players/${playerId}/voice/start`, {});
      setRecording(true);
    } catch (err) {
      stopLocal();
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; message: string }>(`/players/${playerId}/voice/stop`, {});
      setMsg(r.message);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      stopLocal();
      setBusy(false);
    }
  };

  const allowed = micAllowed(window);
  const https = allowed ? undefined : secureUrl(location, httpsPort);
  return (
    <section className="pl-card pl-voice">
      <h2>🎙 Your voice</h2>
      <p className="muted small">{samplesLabel(samples)}</p>
      {!allowed ? (
        <p className="small">
          Phones can only use the microphone on a secure page.{" "}
          {https ? (
            <>
              <a href={https}>Open this page over https</a> (accept the certificate warning once), then come back here.
            </>
          ) : (
            "Ask the host to turn on HTTPS_PORT."
          )}
        </p>
      ) : (
        <>
          <div className="pl-voice-row">
            {recording ? (
              <button className="primary" disabled={busy} onClick={() => void finish()}>
                ⏹ Done
              </button>
            ) : (
              <button disabled={busy} onClick={() => void start()}>
                ● {samples > 0 ? "Record again" : "Record my voice"}
              </button>
            )}
            {recording && <span className="pl-voice-level" style={{ width: `${Math.round(Math.min(1, level * 2) * 100)}%` }} />}
          </div>
          {recording && <p className="small">Say your name and a sentence, for example: "Hi, I'm Sam, playing Thorin the dwarf." Then press Done.</p>}
          {msg && <p className="muted small">{msg}</p>}
          <label className="pl-voice-toggle">
            <input type="checkbox" checked={phoneMic} onChange={(e) => setPhoneMic(e.target.checked)} /> Use my phone as my mic
          </label>
          {phoneMic && <PhoneMicCall playerId={playerId} connected={view.connected} floor={view.floor} />}
        </>
      )}
    </section>
  );
}

/**
 * The phone in the call as its player's mic (rtc_join micOnly): linked to the room only, its mic sent
 * only while the player holds Talk; /table mixes it toward the DM and closes the room mic meanwhile.
 */
function PhoneMicCall({ playerId, connected, floor }: { playerId: string; connected: boolean; floor: FloorView | null }) {
  const call = useCall({ page: "player", connected, floor, playerId });
  const status = phoneMicStatus({ joined: call.self !== null, refused: call.refused, error: call.error, hasMic: !!call.localMic });
  return (
    <p className="muted small">
      {status}
      {call.displaced && (
        <>
          {" "}
          <button onClick={call.takeSeat}>Use this phone</button>
        </>
      )}
    </p>
  );
}
