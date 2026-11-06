# HTTP protocols and Azure Front Door

Public traffic reaches the manage app through **Azure Front Door**, then Azure App Service. Protocol choices must match that topology.

## Current best practice

| Hop                               | Protocol today                            | Notes                                                                |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Browser → Azure Front Door        | HTTPS with **HTTP/2** (HTTP/1.1 fallback) | Front Door terminates TLS and speaks modern HTTP to clients.         |
| Front Door → App Service (origin) | **HTTP/1.1**                              | Microsoft documents this for Front Door origins.                     |
| Node / Express in the container   | **HTTP/1.1** `app.listen`                 | Correct for an origin behind Front Door; keep `trust proxy` enabled. |

**Do not** add an in-process HTTP/3 or QUIC listener in the Node/TypeScript app:

- Node’s `node:quic` / HTTP/3 server surface is still experimental, needs a specially built binary plus `--experimental-quic`, and is not available on ordinary Node 24 runtimes used here.
- Third-party native QUIC packages are not appropriate for this Azure App Service origin: clients never reach Node’s UDP listener while Front Door is in front.
- Optimum user-facing performance for HTTP/3 comes from enabling it **at the CDN edge**, not in the origin process.

## HTTP/3 + QUIC — enable at Azure Front Door

When Microsoft ships HTTP/3 (QUIC) on Azure Front Door Standard/Premium for this shared profile, enable it **on Front Door** (portal, ARM/Bicep, or Terraform once the provider exposes the setting). Until then:

- Keep documenting the intent in `infrastructure/front-door.tf`.
- Do not advertise a misleading `Alt-Svc: h3=…` from the origin while the edge cannot serve HTTP/3.
- After edge HTTP/3 is on, verify UDP/443 path, TLS 1.3, and that browsers negotiate `h3` on the public hostname (Chrome DevTools Protocol column / `Alt-Svc`).

App-level performance work that _does_ help today stays in the origin: fingerprinting, Brotli, cache headers, CSP, and keeping responses streamable — not a Node QUIC stack.
