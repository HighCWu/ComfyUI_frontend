# ADR-EMBED-0001: Cross-origin editor plugin bridge

Date: 2026-11-09

## Status

Accepted for local implementation. Default launch and production enablement
remain unchanged pending real-editor browser acceptance.

## Context

DomonAI uses original DSH as its host and wants the complete editor available
inside it without importing editor implementation into the host runtime.
The editor must also retain its standalone entry. Parent platform SPEC 0138
records the integration contract and authorization boundaries.

## Decision

Use a gated core extension in the editor iframe. Communicate through the
versioned `domon-comfy/v1` message protocol with exact parent origin, source
window and per-mount channel checks. Keep the protocol receiver separate
from the graph adapter. Reuse editor workflow tracking and validation rather
than introducing another document store or undo stack.

Reject edit, undo and restore requests while automatic queueing is enabled;
do not change that setting or invoke execution. Keep identity and funded
execution enforcement in the platform service. This interface does not
authorize saving, running arbitrary JavaScript or starting GPU work.

## Alternatives and consequences

Direct host imports would couple runtime internals and complicate licensing
boundaries. A saved-file-only API would omit current unsaved edits. The iframe
boundary preserves independent boot and routing but requires explicit identity,
appearance and lifecycle handling. It is not itself a legal GPL exemption.

Protocol and navigation unit tests do not prove real-canvas mutation, iframe
cookie behavior or immediate-unmount draft retention. Full theme-role mapping,
deep-route reloads and native DSH model-to-client transport remain separate
acceptance requirements before default enablement.
