# ADR-CRDT-EMBEDDED-0045: Explicit Headless Follower Ownership

Date: 2026-11-10

## Status

Accepted

## Context

An embedded editor may follow an explicitly selected native document without
mounting the Agent panel. The original panel's lifecycle owns its follower and
human-operation minters. Its official transport is globally selected at setup,
not only while the panel is enabled, so borrowing that selection would route an
embedded controller through an unintended connection.

## Decision

The embedded controller reuses the existing follower and minters, explicitly
passing the existing Comfy socket transport. Existing panel callers retain
their default transport. No second graph operation engine, runtime, or socket
protocol is introduced.

The child resolves its own identity and permits only its current canonical
native workflow as the initial target. Parent bridge messages select a document
but confer no access. Custom aliases require authoritative metadata and are
not inferred from titles. Document-host authorization remains authoritative.

Headless activity and enqueue checks synchronously exclude an enabled panel.
Panel activation, child identity/session changes, workflow replacement and
disposal tear down the headless scope and both minters. The controller forwards
the existing restore-minter graph lifecycle while it owns the binding.

## Alternatives

Opening the Agent panel's product gate would change the UI and conflate two
owners. A second CRDT implementation would duplicate semantic and retry logic.
Using the global default transport would let a mounted but disabled panel
silently redirect the headless connection. These alternatives are rejected.

## Consequences

The fork adds a small explicit dependency seam and an embedded-only controller.
Canonical-path support does not claim alias support or production browser SSO.
Existing native document and socket lifecycle rules remain unchanged.
