---
title: Online play (Cloudflare Tunnel, table code, host password)
area: setup
topic: online-play
related_code:
  - apps/server/src/auth/**
  - apps/server/src/routes/auth.ts
  - apps/web/src/signin/**
  - apps/web/src/host/OnlineCard.tsx
  - apps/web/src/host/online.ts
  - apps/web/src/host/online.test.ts
  - apps/web/vite.config.ts
created: 2026-10-22
last_updated: 2026-10-22
last_audited: 2026-10-23
audited_by: claude
status: current
change_log:
  - "2026-10-22: Online card is now a collapsed Party tab section; seat status and Kick moved to the seats"
  - "2026-10-22: B3/B4: Sign out other host devices; host logout revokes every host cookie; LAN invite-link seats show online"
  - "2026-10-22: ssh -R/socat-style forwarders give internet callers the host bypass (Host is the caller's), not LAN trust: LOCAL_FORWARDER=1; the phone mic button is hidden below table access"
  - "2026-10-22: Local proxies must set X-Forwarded-For (others get LAN trust at most); host bypass needs localhost; upgrade note: push-to-talk on by default"
  - "2026-10-22: Section 6: call members see each other's public IP addresses"
  - "2026-10-22: Phase 5: the WebRTC call (what works), section 6 on STUN/TURN and ICE_SERVERS (media is P2P, never through the tunnel), troubleshooting rows"
  - "2026-10-22: Phase 4: a remote player lands on /play/:id (board, dice, push-to-talk, typed input); home phones keep /player"
  - "2026-10-22: Phase 3: push-to-talk for everyone, the room included"
  - "2026-10-22: Review fixes: rate-limit key only from a proxy on this machine, IPv6 /64 buckets and a global budget, two-word table codes, ONLINE_URL apart from PUBLIC_URL, TRUSTED_HOSTS, stale seat takeover, safeNext resolves like the browser"
  - "2026-10-22: Initial version (phase 1: tunnel walkthrough, table code, host password, Online card)"
---

# Online play

A game can mix people **in the room** (TV, shared mic, phones on the home Wi-Fi) with friends
**online**. The server stays on your machine; online players reach it through a Cloudflare Tunnel
and join with a **table code**. How access works inside the server is in
[authentication](../server/auth.md).

What works: remote players join with the code, pick their seat and play on `/play/:id` (the TV's
board, dice and party, their sheet, typed input); they only receive what the table can see; and
**push-to-talk** (`PUSH_TO_TALK`, on by default) decides who is talking to the DM, for the room too:
hold Space on the TV or the **Hold to talk** button
([push-to-talk](../server/realtime-audio-and-turns.md#push-to-talk-floor-push_to_talk-gamefloorts)).
Remote players and the room see and hear each other in a peer-to-peer **WebRTC call** (webcams or
character cards; the DM's voice is forwarded to remote players by the TV), and players talk freely
to each other the rest of the time ([online call](../web/online-call.md)).

**Upgrading from an in-room-only version:** push-to-talk is **on by default**. Nobody talks to the DM
until they hold to talk: Space on the TV, the host's **Talk** button on the `/host` Play tab, or
**Hold to talk** on a phone. `PUSH_TO_TALK=0` restores the open mic. The phone's mic-mute button
(it mutes the whole room's mic) works for in-room phones only, not for remote players.

## 1. Settings

In `.env` (see [configuration](configuration.md#online-play)):

```bash
ONLINE_URL=https://dnd.example.com   # the tunnel's address: invite links use it
HOST_PASSWORD=pick-something-long    # to run /host or /table from another machine
TABLE_CODE=                          # empty: one is made (WOLF-RUNE-7342) and can be rotated
TRUST_LAN=1                          # home-network phones and TV need no code
HOST_LOCAL_BYPASS=1                  # this machine's browser is the host without a password
```

**Keep `PUBLIC_URL` for the LAN address (or empty).** The TV's join QR code and the host's player
QR codes use it. A phone that comes in through the tunnel is remote and would need the code, so
in-room QR codes must not point at the tunnel. Only the invite link uses `ONLINE_URL`.

If your router gives the server a name like `gamebox.fritz.box` and phones open it that way, add the
suffix to `TRUSTED_HOSTS=fritz.box`. Other dotted names from the LAN are refused as DNS rebinding.

The defaults keep the in-room game as it was: the browser on the server machine is the host, and
phones and the TV on the home network need no code.

**A laptop running `/host` on the LAN now needs the password.** The home network gets table access
(TV, phones), not host access. Set `HOST_PASSWORD` and sign in once at `/login` on the laptop (the
cookie lasts 30 days, or until a host logout). Without a password, `/host` only works on the server machine.

## 2. Cloudflare Tunnel

Use the production server (`pnpm build && pnpm start`): it serves the web app and the API on one
port. Then point a tunnel at it:

```bash
# quick test: a random https://<words>.trycloudflare.com address, no account needed
cloudflared tunnel --url http://localhost:8787

# or a named tunnel on your own domain (Cloudflare account, domain on Cloudflare)
cloudflared tunnel login
cloudflared tunnel create dnd
cloudflared tunnel route dns dnd dnd.example.com
cloudflared tunnel run --url http://localhost:8787 dnd
```

- Put the tunnel's https address in `ONLINE_URL` and restart the server. The startup log prints the
  table code and the invite address.
- WebSockets (`/ws`) go through the tunnel with no extra setting.
- **The HTTPS port (`HTTPS_PORT`) is not needed behind the tunnel.** Cloudflare serves https (so
  browsers allow the mic and camera) and forwards plain http to `localhost:8787`. The cookie is marked
  `Secure` from the tunnel's `x-forwarded-proto`.
- Every tunnelled request reaches the server from 127.0.0.1. The server tells them apart by the
  `CF-Connecting-IP` header Cloudflare adds, so they never get the "this machine is the host" bypass.
  **Don't put another proxy in front that drops that header.** A proxy on this machine that sets
  `X-Forwarded-For` (Caddy, nginx) also works; one on another machine is not trusted to name the
  client's address (rate limits then count all its traffic as one caller).
- **A local proxy (nginx, Caddy) must set `X-Forwarded-For`** (Caddy does by default; nginx needs
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Without it every request arrives
  from 127.0.0.1, and the server can only go by the `Host` header, which **the caller writes**. An
  honest browser asking for `ONLINE_URL`'s host is treated as remote, but anyone can send
  `Host: localhost` and get **the host bypass**. nginx's default (`Host` rewritten to `127.0.0.1`,
  no `X-Forwarded-For`) is the same.
- **A forwarder that adds no header (`ssh -R`, socat, nginx without `X-Forwarded-For`): set
  `LOCAL_FORWARDER=1`.** Every request from 127.0.0.1 is then remote, whatever its `Host`. Your own
  browser on this machine then signs in too: set `HOST_PASSWORD` and use `/login`. (`TRUST_LAN=0`
  alone does **not** help here: the bypass comes from `HOST_LOCAL_BYPASS`.)

### Optional: Cloudflare Access

For a second lock in front of the game, add a Cloudflare Access application for the tunnel's
hostname (Zero Trust → Access → Applications) with an email-code policy listing your players. They
then sign in to Cloudflare first and still need the table code. The server needs no change.

### Without a tunnel: raw IP and port

You can forward a router port to `8787` (or `8443` for https) instead. Set `ONLINE_URL` to
`http(s)://<your public IP>:<port>`. Requests then come from the players' own addresses, which are
remote, so the same code and password rules apply. Browsers only allow the mic and camera on https,
so use the HTTPS port with a real certificate (`HTTPS_CERT`/`HTTPS_KEY`), or the tunnel.

## 3. Players join

1. On the host screen, Party tab, the **Online** card shows the table code. **⧉ Copy invite link**
   copies `ONLINE_URL/join?code=…`; send it to your players.
2. A player opens it (`/join`). With the code in the link they skip typing it; otherwise they type
   it (case, spaces and dashes don't matter).
3. They pick their seat from the human players the host added. The server binds their browser to
   that seat. Through the tunnel they land on **`/play/<seat>`**: the TV's board, dice and party
   with their sheet in a drawer, push-to-talk (hold Space or the button) and a box to type to the DM
   ([remote play](../web/remote-play.md)). Their browser asks for the mic and camera once; they
   hear the room and the DM through the call and see everyone's tiles ([online call](../web/online-call.md)).
   The TV (`/table`) must be open for remote players to hear the DM and for their voice to reach it.
4. A seat held by another device shows "playing on another device". The host frees it with
   **Kick**. A seat whose device has been gone for 2 minutes (no open connection) can be taken by a
   new sign-in, so a player who switched browsers or cleared cookies just joins again.

Phones on the home Wi-Fi with `TRUST_LAN` on can open `/player` as before, or `/join` (no code);
from the home network `/join` lands on the `/player` sheet, since the TV is in the room.

## 4. The Online section

On the Party tab, the **Online** section sits below the seats and is closed by default. Its summary line shows the code and how many players are online.


- **Table code** with **↻ Rotate**: a new code signs every remote player out (their sockets close)
  and frees every seat. Hidden when `TABLE_CODE` is set; change it in `.env` and restart instead.
- **Copy invite link**, and a reminder when `ONLINE_URL` is empty.
- **Sign out other host devices** (only with `HOST_PASSWORD`): every other browser signed in as the
  host has to sign in again; this one stays in.
- Each human seat shows its sign-in on the seat itself, not in this section: an online dot in the
  seat list (● online, ○ joined but offline), the status in the selected seat's header, and **Kick**
  there. A phone on the home Wi-Fi that joined with the invite link counts too. Kick frees the seat
  and closes that player's sockets. A kicked player who knows the code can join again, so rotate
  the code too if they shouldn't.

## 5. Host from another machine

Open `<address>/host` and you are sent to `/login`. Enter `HOST_PASSWORD`. Changing or clearing the
password in `.env` signs every host out, and so does logging out on any host device (the server
revokes every host cookie, not only that browser's); **Sign out other host devices** in the Online
section does it while keeping you signed in. Ten wrong passwords or codes from one address (an IPv6
/64 counts as one) lock it out for 10 minutes; 100 from all addresses together pause sign-in for
everyone for 10 minutes and log a warning (rotate the code if you see it).

## 6. Video and voice: STUN, TURN and `ICE_SERVERS`

The call is **peer to peer**: audio and video go straight between the players' browsers and the TV.
They do **not** go through the Cloudflare tunnel or the server, which only passes the short setup
messages (signaling) over `/ws`. So the tunnel's bandwidth doesn't matter. What matters is that each
pair of browsers can reach each other.

**Privacy:** because the connections are direct, every member of the call (and the TV's machine)
learns the other members' public IP addresses. That's normal for WebRTC calls, but worth telling
players who only know each other online. A TURN server can relay media, but the app doesn't force
relay-only mode yet.

The ways to connect:

- **STUN** (the default: Cloudflare's and Google's public servers) lets two browsers behind ordinary
  home routers find a direct path. That works for most homes.
- **TURN** relays the media when no direct path exists (strict NAT, carrier-grade NAT on mobile
  data, some office or school networks). Symptom: a tile stays on "connecting…" or "can't connect".
  Add a TURN server to `ICE_SERVERS` (JSON, the browser's `RTCIceServer` list) and restart:

```bash
ICE_SERVERS=[{"urls":"stun:stun.cloudflare.com:3478"},{"urls":["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"],"username":"dnd","credential":"long-secret"}]
```

  Any TURN service works: a hosted one (Cloudflare Calls TURN, Twilio, Metered, …) or your own
  `coturn`. Keep the STUN entry so direct paths are still tried first. The list is served to the
  pages at `GET /api/rtc/config` (players can read it, so use credentials meant for this game).
- Each page sends its camera to every other member at 360p, about 300 kbps. With 5 remote players
  that is about 1.5 Mbit/s upload per page.
- Mics and cameras need https (or `localhost`): the tunnel gives remote players https; the TV on the
  server machine is `localhost`.

## Development

In `pnpm dev`, Vite (`:5173`) proxies `/api` and `/ws` with `xfwd`, so the server sees each browser's
real address: the laptop's own browser is local, a phone on the Wi-Fi is lan. Use the production
server for the tunnel.

## Troubleshooting

| Symptom | Cause |
|---|---|
| A remote player is sent back to `/join` | The code was rotated, the host kicked their seat, or the 30-day cookie expired |
| A host laptop is sent back to `/login` | The host logged out on some device, or used **Sign out other host devices**, or `HOST_PASSWORD` changed |
| "That code doesn't match" | Wrong code, or it was rotated; check the Online card |
| "Too many wrong tries" | 10 wrong codes or passwords from that address (or /64) in 10 minutes, or 100 from everyone (the log warns) |
| In-room phones that scan the TV's QR code are sent to `/join` | `PUBLIC_URL` is the tunnel address; move it to `ONLINE_URL` |
| A LAN phone opened by a router name (`*.fritz.box`) is sent to `/join` | Add the suffix to `TRUSTED_HOSTS` |
| The host page on a LAN laptop goes to `/login` | Expected: the LAN is table access. Set `HOST_PASSWORD` |
| `/login` says host sign-in is off | `HOST_PASSWORD` is empty |
| A video tile stays on "connecting…" / "can't connect" | No direct path between those two homes: add a TURN server to `ICE_SERVERS` (section 6) |
| A remote player is heard by nobody / hears no DM | The TV (`/table`) isn't open, or another table screen carries the call (only one is the room) |
| Everything behind your own proxy acts as the host | The proxy forwards from 127.0.0.1 without `X-Forwarded-For` or `CF-Connecting-IP`, so `Host` decides and the caller writes it; turn on forwarding headers, or set `LOCAL_FORWARDER=1` |
| The host page on this machine goes to `/login` | It was opened as `gamebox.local` or the LAN IP, which count as the LAN; open `http://localhost:8787/host` |
| A phone has no 🎙 mic button on `/player` | Expected below table access (a remote seat, or `TRUST_LAN=0`): it mutes the whole room's mic; only in-room phones under `TRUST_LAN` and the host can (`/play` has no such button) |
