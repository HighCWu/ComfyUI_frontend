# ADR-WORKFLOW-LAUNCH-0044: Session-bound Saved-file Launch Intent

Date: 2026-10-22

## Status

Accepted

## Context

The Laimon studio lists saved user files outside the native editor. Opening a
file must retain its native file identity and Agent document integration. A raw
graph import creates a different editing context. Background tab restoration can
also replace an explicitly selected workflow after startup has loaded it.

## Decision

Use the existing owner-bound editor session and editor-launch boundary for a
saved-file selection. The backend owns file authorization and selection revision;
the frontend does not infer these facts from a URL or local storage.

Resolve the authorized path through native metadata synchronization and open it
with the native workflow service. Keep published/API graph imports on their
existing branch. Do not add an outer editor shell or a second file store.

Represent launch as absent, loaded or failed. An explicit selection takes
precedence over persisted tabs and retained template/share intent. Failure must
be visible and must not restore an unrelated file. A session without a launch
selection retains normal persistence behavior.

## Alternatives

- A filename query parameter is easy to add but does not represent server-owned
  authorization or revision selection.
- Importing graph JSON avoids native file lookup but loses saved-file identity.
- Restoring tabs after a successful explicit launch preserves more old UI state
  but can activate the wrong workflow.

## Consequences

The fork adds no canvas controls and reuses native editing behavior. The studio
and backend must ship a compatible saved-file launch protocol with this loader.
Metadata lookup or revision failure requires reopening from a refreshed studio
list; it is not permission to choose another file. Opening remains separate from
model preparation, execution admission and charging.
