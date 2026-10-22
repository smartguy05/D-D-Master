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
last_audited: 2026-10-22
audited_by: claude-opus-5.5
status: current
change_log:
  - "2026-10-22: Review fixes: rate-limit key only from a proxy on this machine, IPv6 /64 buckets and a global budget, two-word table codes, ONLINE_URL apart from PUBLIC_URL, TRUSTED_HOSTS, stale seat takeover, safeNext resolves like the browser"
  - "2026-10-22: Initial version (phase 1: tunnel walkthrough, table code, host password, Online card)"
---

# Online play

A game can mix people **in the room** (TV, shared mic, phones on the home Wi-Fi) with friends
**online**. The server stays on your machine; online players reach it through a Cloudflare Tunnel
and join with a **table code**. How access works inside the server is in
[authentication](../server/auth.md).

What works today (phase 1): remote players can join with the code, pick their seat and use their
phone sheet (`/player/:id`). The remote play page with the map, push-to-talk and webcams comes in
later phases (see `.memories/features/online-play.md`).

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
cookie lasts 30 days). Without a password, `/host` only works on the server machine.

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
   that seat, and they land on their sheet.
4. A seat held by another device shows "playing on another device". The host frees it with
   **Kick**. A seat whose device has been gone for 2 minutes (no open connection) can be taken by a
   new sign-in, so a player who switched browsers or cleared cookies just joins again.

Phones on the home Wi-Fi with `TRUST_LAN` on can open `/player` as before, or `/join` (no code).

## 4. The Online card

- **Table code** with **↻ Rotate**: a new code signs every remote player out (their sockets close)
  and frees every seat. Hidden when `TABLE_CODE` is set; change it in `.env` and restart instead.
- **Copy invite link**, and a reminder when `ONLINE_URL` is empty.
- Each human seat: free, joined (offline) or online (devices), with **Kick**. Kick frees the seat
  and closes that player's sockets. A kicked player who knows the code can join again, so rotate
  the code too if they shouldn't.

## 5. Host from another machine

Open `<address>/host` and you are sent to `/login`. Enter `HOST_PASSWORD`. Changing or clearing the
password in `.env` signs every host out. Ten wrong passwords or codes from one address (an IPv6
/64 counts as one) lock it out for 10 minutes; 100 from all addresses together pause sign-in for
everyone for 10 minutes and log a warning (rotate the code if you see it).

## Development

In `pnpm dev`, Vite (`:5173`) proxies `/api` and `/ws` with `xfwd`, so the server sees each browser's
real address: the laptop's own browser is local, a phone on the Wi-Fi is lan. Use the production
server for the tunnel.

## Troubleshooting

| Symptom | Cause |
|---|---|
| A remote player is sent back to `/join` | The code was rotated, the host kicked their seat, or the 30-day cookie expired |
| "That code doesn't match" | Wrong code, or it was rotated; check the Online card |
| "Too many wrong tries" | 10 wrong codes or passwords from that address (or /64) in 10 minutes, or 100 from everyone (the log warns) |
| In-room phones that scan the TV's QR code are sent to `/join` | `PUBLIC_URL` is the tunnel address; move it to `ONLINE_URL` |
| A LAN phone opened by a router name (`*.fritz.box`) is sent to `/join` | Add the suffix to `TRUSTED_HOSTS` |
| The host page on a LAN laptop goes to `/login` | Expected: the LAN is table access. Set `HOST_PASSWORD` |
| `/login` says host sign-in is off | `HOST_PASSWORD` is empty |
| Everything behind your own proxy acts as the host | The proxy forwards from 127.0.0.1 without `X-Forwarded-For` or `CF-Connecting-IP`; turn on forwarding headers, or set `HOST_LOCAL_BYPASS=0` |
