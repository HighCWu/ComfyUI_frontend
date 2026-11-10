# ADR-WORKFLOW-IMPORT-0047: Guarded API Import Continuations

Date: 2026-11-11

## Status

Accepted

## Context

An embedded host can change identity or workflow while API import awaits an
extension or node-replacement preparation. Checking only outside the importer
cannot prevent its continuation from clearing or activating a newer graph.

## Decision

The existing API importer accepts an optional `assertCanImport` callback. Its
guarded path completes preparation before deactivating the previous draft or
clearing the graph. The importer checks graph and active-workflow identity at
later asynchronous boundaries; the external owner checks identity and automatic
queue policy. Stale guarded continuations reject with `AbortError`.

Embedded host ports v3 expose the existing API format check and importer. The
normal converter and workflow service remain authoritative; the external App
does not construct a second converter or create a native document on import.
Passing an empty filename uses normal temporary naming rather than reusing a
saved workflow whose filename happens to match a public title.

## Alternatives

An outer abort signal alone does not guard the importer's internal awaits.
Duplicating conversion or importing into a second hidden graph would add another
workflow implementation. Automatically creating server documents adds unrelated
persistence and authorization. These alternatives are rejected.

## Consequences

Calls without the optional callback retain their normal sequence. Guarded import
and its App-owned consumer must be assembled with matching host-port versions.
The old draft is retained by normal workflow services; saving is a separate user
action. Already executed synchronous or third-party extension effects are not
promised to roll back. No execution or financial authority is added.
