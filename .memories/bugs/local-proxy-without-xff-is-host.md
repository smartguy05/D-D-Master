# Bug: a local proxy without forwarding headers made internet callers the host
Status: fixed (2026-10-22)
Area: server / auth

## Overview
A proxy on the server machine that adds neither `CF-Connecting-IP` nor `X-Forwarded-For`
(`ssh -R`, nginx with `proxy_set_header Host $host` and no XFF, socat) delivers internet requests
from 127.0.0.1. `classifyOrigin` called them `local`, because `homeHostname` trusted
`ONLINE_URL`'s host, so `HOST_LOCAL_BYPASS` made every such caller the host.

## Repro
`ONLINE_URL=https://dnd.example.com`, a proxy forwarding to `localhost:8787` keeping `Host:
dnd.example.com` and adding no forwarding header. `GET /api/campaigns` from the internet: 200.

## Root cause / Fix
`auth/origin.ts` `classifyOrigin`:
- new option `remoteHosts` (Auth passes `ONLINE_URL`'s hostname): a request whose `Host` is one of
  them or a subdomain is **remote** whatever its peer. `ONLINE_URL` is no longer a trusted home
  name (still an allowed `Origin`).
- `local` additionally needs a loopback `Host` name (`localhost`, `*.localhost`, `127.0.0.0/8`,
  `::1`). A loopback peer with any other home name (`gamebox.local`, the LAN IP, `0.0.0.0`) or
  **no Host** is `lan` at most. No Host was chosen as lan, not local: browsers always send it,
  and Node rejects HTTP/1.1 without it, so only HTTP/1.0 tools or a proxy that dropped it reach
  here. Not remote either, so a LAN-trusted CLI keeps working.
Tests: origin.test.ts "classifyOrigin: proxies that add no forwarding header"; app.auth.test.ts
"a request for the ONLINE_URL host from loopback ..." and "a loopback request for a home name that
isn't a loopback name gets LAN trust at most".

## Notes
- Vite dev (xfwd, Host kept `localhost:5173`) is unchanged: local for this machine, lan for phones.
- Behaviour change: opening `/host` on the server machine as `gamebox.local` or its LAN IP is now
  table access (with `TRUST_LAN`), not host. Use `localhost`.
- Still open: nginx's **default** proxy (Host rewritten to `127.0.0.1:8787`, no XFF, HTTP/1.0)
  is indistinguishable from this machine's browser by Host alone. Docs require XFF on local
  proxies. A possible heuristic: browsers never speak HTTP/1.0 to us, nginx does by default, so a
  loopback HTTP/1.0 request could be demoted (needs the request's httpVersion in `Auth.caller`).
- **Wrong (corrected 2026-10-22):** this fix was first documented as giving header-less
  forwarders (ssh -R, socat) "LAN trust at most". The `Host` is the caller's own through such a
  forwarder, so `Host: localhost` still got the host bypass. Fixed by `LOCAL_FORWARDER`, see
  bugs/forged-localhost-host-through-forwarder.md.

## TODOs
- [ ] Decide on demoting loopback HTTP/1.0 requests (nginx default proxy) below local.

## Completed
- 2026-10-22: Docs corrected (forwarders without headers give the host bypass, not LAN trust); LOCAL_FORWARDER added.
- 2026-10-22: remoteHosts + loopback Host requirement, with tests and docs.
