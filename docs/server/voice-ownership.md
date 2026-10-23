---
title: Voice call ownership (/table carries the call)
area: server
topic: realtime
related_code:
  - apps/server/src/game/voice-owner.ts
  - apps/server/src/game/voice-owner.test.ts
  - apps/server/src/hub.ts
  - apps/server/src/hub.test.ts
  - apps/server/src/game/service.table-voice.test.ts
  - apps/web/src/table/useTableVoice.ts
  - apps/web/src/table/voicePlan.ts
  - apps/web/src/table/voicePlan.test.ts
created: 2026-10-21
last_updated: 2026-10-23
last_audited: 2026-10-23
audited_by: claude
status: current
change_log:
  - "2026-10-23: pickAudioSource takes a phone enrollment's own stream (role player)"
  - "2026-10-22: The TV's own Space pre-opens the room mic before the server's floor (localPress); phones keep the round trip"
  - "2026-10-22: Phase 5: the DM mix (dmMixer, replaceStream) and the DM's audio forwarded to the call (dmTrack)"
  - "2026-10-22: The table applies the push-to-talk floor to its mic track (tableMicEnabled); ptt/floor events; Hub.accessOf"
  - "2026-10-22: Hub tests cover viewer tiers; the table's snapshot now follows its hello"
  - "2026-10-22: Hub roles are clamped to the socket's access (a player can't claim table or host)"
  - "2026-10-21: Created: /table owns the WebRTC call, mic and DM audio; /host sends commands (voice_command), sees voice_owner; audio source pick; auto-resume (bugs/closing-host-kills-dm)"
---

# Voice call ownership (`/table` carries the call)

The browser side of the voice DM (the WebRTC call to OpenAI, the table mic and the DM's audio)
runs on the **`/table`** page, not on `/host`. `/host` is controls only: it asks the table to
start, stop or rebuild the call and shows the call's state. So the host tab can be closed (or
reloaded) mid-game and the DM keeps talking. Voice-ID **enrollment** still runs on `/host` with
its own mic stream.

Both tabs are expected on the same laptop (`localhost`, so the mic is allowed). Before this the
call lived in `HostPage`, and closing the host tab took the DM offline
(`.memories/bugs/closing-host-kills-dm.md`).

## Roles and events

`Hub` (`apps/server/src/hub.ts`) records each socket's role from its `hello`
(`host | table | player`), clamped to the socket's access ([authentication](auth.md#websockets):
a remote player can't claim `table` and take the voice call), and passes client messages to `onClientEvent` listeners; `onClose`,
`send(ws, ev)` (one client), `roleOf(ws)` and `withRole(role)` (open sockets, oldest first) let
`GameService` talk to one table screen.

| Event | Direction | Meaning |
|---|---|---|
| `voice_link` `{state, error?}` | `/table` → server (ClientEvent) | The table's call changed state (`idle | connecting | connected | reconnecting | failed`) |
| `voice_owner` `{owner: {table, link, error?, micStream}}` | server → all (in the connect snapshot) | Is a table screen open, its call state, and whether a table mic stream feeds voice ID |
| `voice_command` `{action: start|stop|reconnect}` | server → the owner table only | Start a call, hang up, or rebuild one (resume) |
| `voice_handover` `{phase}` | server → all | The [planned renewal](voice-handover.md); the table drives it |
| `ptt` `{down, playerId?}` | any page → server (ClientEvent) | Push-to-talk press or release; `/table` without a seat is the room |
| `floor` `{floor: {pushToTalk, holder}}` | server → all (in the snapshot) | Who holds the push-to-talk floor; the table opens its mic for the room |

`VoiceLinkState` and `VoiceOwnerView` live in `packages/shared/src/events.ts`.

## Who owns the call (`game/voice-owner.ts`, pure)

- `pickVoiceOwner(tables, claimed)`: the table whose call is up (it claimed it with a non-idle
  `voice_link`), else the newest table. A second `/table` tab never takes a live call away. An
  `idle` report from a non-owner table is ignored.
- `voiceOwnerView({tables, link, tableAudio})`: what `/host` shows. With no table open the link
  reads `idle`.
- `pickAudioSource({enrolling, from, host, table, player})`: which `/ws/audio` stream feeds the
  speaker ring. Both hear the same table, but interleaved chunks would garble voice ID. While a voice
  is being recorded, the recording's own source wins if it streams: the player's phone for a phone
  enrollment (`from: "player"`, [speaker ID](speaker-id.md)), else `/host`; otherwise the table's;
  else the host's. A phone stream never feeds play-time voice ID.

`GameService` keeps `voiceLink` (the claiming socket and its state), counts audio sockets per role
(`audioSocket(role, ±1)`, a table change re-broadcasts `voice_owner`) and re-broadcasts
`voice_owner` on a table `hello`, a `voice_link` and a table socket closing.

## Audio for voice ID

`/ws/audio?role=host|table` (default `table`, read in `app.ts`). `GameService.pushAudio(chunk,
source)` drops chunks from the source `pickAudioSource` didn't pick (it accepts all when no
socket is tracked, e.g. in tests). `SpeakerService.enrolling` is true from `startEnrollment` until
`finishEnrollment`, capped at `ENROLL_MAX_MS` (120 s) so a forgotten recording stops counting.

## Commands from `/host`

- `POST /api/dm/voice/start` and `/api/dm/voice/reconnect` → `GameService.requestVoice(action)`,
  which sends `voice_command` to the owner table. With no table screen open it throws "Open the
  table screen (/table) first: it runs the mic and the DM's voice." `start` also needs
  `OPENAI_API_KEY`.
- The table then POSTs its SDP offer to `/api/dm/voice` (`?resume=1` for a reconnect).
- `POST /api/dm/stop` → `stopDm()`, which now also sends `stop` to the owner table (otherwise the
  call would keep talking with no tools). `startVoice` replaces an old DM with
  `stopDm({ keepCall: true })`, so the table doesn't hang up the call it is building.
- The text DM (`/api/dm/text`) needs no table screen.

## The table side (`apps/web/src/table/useTableVoice.ts`)

`useTableVoice(view)` (used by `TablePage`) owns one `VoiceLink`, the table mic (`getTableMic`)
and a `MicStreamer("table")` that streams it to `/ws/audio`. It:
- reports every link state change as `voice_link` (and again after a `/ws` reconnect, since the
  server forgot it);
- runs `voice_command`s: `start` → `link.start(mic)`; `reconnect` → `link.reconnect()` when a call
  is active, else `link.resume(mic)`; `stop` → `link.stop()` and releases the mic;
- drives the planned handover (`prepareHandover` / `commitHandover`, falling back to `reconnect()`
  when a swap finds no standby, / `abortHandover`);
- applies the table mic mute and the [push-to-talk floor](realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts)
  to its stream (`applyMicMute` with `lib/floor.ts` `tableMicEnabled`): with push-to-talk on, the
  track is enabled only while the room or an in-room player holds the floor, plus a 600 ms tail. The
  TV's own Space opens it at once (`useTableVoice(view, localPress)`, `TalkPress.waiting`: pressed,
  not yet granted, on a free floor) rather than when the server's floor comes back, so the first
  syllable isn't clipped; the server's session gate still drops a turn no hold covered. A phone's
  hold keeps the round trip (the TV only learns of it from the floor broadcast). The
  same tracks feed the call, the handover's standby peer and the voice-ID stream;
- sends the room mic to the call, or the **DM mix** while remote players are in the
  [online call](../web/online-call.md#audio-into-the-dm-appswebsrctabledmmixerts) and WebAudio runs
  (`DmMixer`, `sendMixed`, switched with `VoiceLink.replaceStream`; the mixer's output stream lives
  as long as the page, so reconnect, resume and handover keep working); `mixVoices` takes the remote
  voices from `TablePage`'s call;
- returns the DM's audio track (`dmTrack`, from `VoiceLink.onRemoteStream`) for the call to forward to
  remote players;
- shows the browser's mic prompt in the table tab on the first start;
- re-plays the DM's audio after an autoplay block: `playRemote` calls `play()`, a refusal calls
  `onRemoteAudioBlocked` → `markAudioLocked` (the "Click to enable sound and the DM's voice"
  overlay), and the unlock gesture calls `retryRemoteAudio()` and `MicStreamer.resume()` (an
  AudioContext created before a gesture starts suspended).

**Auto-resume** (`voicePlan.ts` `shouldAutoResume`, pure): once per page load, when `/ws` is up, the
server's DM is a live voice DM, this page's link is `idle` and the server says no table carries a
call (`voice_owner.link` is `idle`; `null` until the snapshot), the table calls
`VoiceLink.resume(mic)`: a new call with `?resume=1` (state `reconnecting`), so the DM continues
without a greeting. A failed or refused resume is left to the host's Reconnect button.

`TablePage` shows a small `🎙 voice: …` pill while the call is connecting, reconnecting or failed.

## Known limits

- Closing `/table` still ends the call, since it carries it. Reopening it within the sideband
  retry window (about 30 s) auto-resumes without a re-greeting; after that the server DM is
  offline and the host presses Start.
- Not live-tested on real hardware yet (mic prompt in the TV tab, autoplay, two tabs on one laptop).

## Tests

- `game/voice-owner.test.ts`: owner and audio-source picks, the host view.
- `hub.test.ts`: roles from hello (clamped to access), `send`, `withRole`, close listeners, `closeWhere`,
  viewer tiers (the TV's snapshot comes after its hello, before the `voice_owner` it triggers).
- `game/service.table-voice.test.ts`: Start needs an open table and goes only to it; the table
  carrying the call keeps it; `/host` sees the call state and loses it when the table closes; a
  host's `voice_link` is ignored; Stop hangs up the table's call, a replacing `startVoice` doesn't;
  voice ID hears the table mic in play and the host mic while enrolling.
- `apps/web/src/table/voicePlan.test.ts`: the auto-resume truth table.
- `apps/web/src/table/dmMixer.test.ts`: the DM mix (gain plan, tail, when to send it, the graph).
- `apps/web/src/lib/voice.test.ts`: `onRemoteStream`, `replaceStream` (live call, reconnect, standby);
  `audioSocketUrl` names the role; `VoiceLink.resume` (a
  reloaded table rejoins with `?resume=1`; a refused resume returns to idle).
