# Bug: a forwarder that passes Host through let the internet claim "Host: localhost" (host bypass)
Status: fixed (2026-10-22)
Area: server / auth

## Overview
After the loopback-Host rule (bugs/local-proxy-without-xff-is-host.md), `classifyOrigin` gave
`local` to a loopback peer whose `Host` is a loopback name. A forwarder on this machine that adds
no `X-Forwarded-For` and passes the client's `Host` unchanged (`ssh -R 80:localhost:8787`, socat,
nginx with `proxy_set_header Host $host` and no XFF) lets any internet caller send
`Host: localhost` and become the host (`HOST_LOCAL_BYPASS`), over HTTP and the `/ws` upgrade. The
docs claimed such forwarders got "LAN trust at most" and suggested `TRUST_LAN=0`, which does
nothing against the bypass.

## Repro
`ONLINE_URL=https://dnd.example.com`, defaults otherwise, exposed through `ssh -R`.
`curl -H 'Host: localhost' https://dnd.example.com/api/campaigns`: 200 (host).
Unit: `classifyOrigin("127.0.0.1", {host: "localhost"}, {remoteHosts: ["dnd.example.com"]})` is local.

## Root cause / Fix
Headers can't tell this machine's browser from a pass-through forwarder: both arrive from
127.0.0.1 with whatever `Host`/XFF the client wrote. New opt-in `LOCAL_FORWARDER` (config
`localForwarder`, `offUnlessOn`) -> `Auth` -> `classifyOrigin(opts.localForwarder)`: every loopback
peer is **remote** (whatever Host, XFF or CF-Connecting-IP), and its rate-limit key stays the peer
address (the caller wrote the headers). The LAN is unchanged. This machine's browser then signs in
with `HOST_PASSWORD`.
Not chosen: turning `HOST_LOCAL_BYPASS` off whenever `ONLINE_URL` is set. That would cost the
recommended cloudflared setup (already safe through `CF-Connecting-IP`) its local bypass.
Tests: origin.test.ts "classifyOrigin: a forwarder that passes the client's headers through
(localForwarder)"; app.auth.test.ts "with LOCAL_FORWARDER, a loopback request is remote even when
it says Host: localhost"; config.test.ts "LOCAL_FORWARDER is off unless set to 1/true/yes/on".
Docs: auth.md origin rule 7, online-play.md section 2 and troubleshooting, configuration.md,
.env.example.

## Notes
- The setting depends on the user knowing their proxy. Cloudflared and proxies that set XFF
  themselves (Caddy, nginx `$proxy_add_x_forwarded_for`) don't need it.
- Any XFF the caller sends through a pass-through forwarder is forged as well, so even XFF can't
  lower trust safely there; `LOCAL_FORWARDER` ignores it.

## TODOs
- [ ] Consider warning at startup when ONLINE_URL is set, no request has carried CF-Connecting-IP
  or XFF, and loopback requests arrive with a non-loopback Host (a hint that a pass-through
  forwarder is in use).

## Completed
- 2026-10-22: LOCAL_FORWARDER option, tests, docs corrected.
