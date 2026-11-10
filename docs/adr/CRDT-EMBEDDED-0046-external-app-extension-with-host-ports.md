# ADR-CRDT-EMBEDDED-0046: External App Extension with Host Ports

Date: 2026-11-10

## Status

Accepted

## Context

The embedded receiver previously combined platform messaging and native-document
opening with private frontend store access. Product behavior belongs to the
ComfyUI App package, while the existing follower, minters, authentication rail
and normal workflow service remain authoritative in the frontend.

## Decision

The frontend exposes a versioned `createEmbeddedHostPorts` factory through the
existing core module compatibility shim. It supplies only the getters, actions
and synchronous subscriptions the App extension currently uses. It does not
expose a Pinia store, construct another identity or document authority, or load
another Vue runtime.

The App-owned extension is advertised through the existing backend extension
list, imported by the existing extension loader, and registered with
`app.registerExtension`. It owns the message receiver, native-open sequencing
and extension lifecycle forwarding. Pairing versions must match; old frontend
artifacts without these exports cannot claim support for the new extension.

## Alternatives

Bundling frontend stores into the external extension would create duplicate
reactive runtimes and potentially independent state. Keeping product behavior
in both locations would create divergent handlers. A new global loader or fetch
override would bypass existing extension and request ownership. These options
are rejected.

## Consequences

Frontend and external extension changes require one coordinated local assembly
and regression run before the parent advances its frontend pointer. Existing
auth, origins, CSP, native document identity, restore, revoke and billing rules
are unchanged. Normal ComfyUI extension disablement still requires reload;
the adapter does not add a second extension manager.
