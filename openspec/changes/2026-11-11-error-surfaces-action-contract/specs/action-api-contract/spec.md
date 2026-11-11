# Spec Delta

## Purpose

One documented two-track contract for how server actions report
failure, replacing today's four divergent conventions.

## ADDED Requirements

### Requirement: Server actions follow a two-track error contract

Actions that must surface failure to a form or button SHALL return
`Promise<{ error?: string }>`; programmatic and paging actions
whose callers already `.catch` rejections SHALL keep throwing.
Debug `console.log` failure paths SHALL NOT remain — caught
failures either return `{ error }` or route through
`lib/report.ts`.

#### Scenario: Pin failure surfaces as state

- **WHEN** `pinVideo` fails for an expected reason (dead id,
  non-embeddable)
- **THEN** it returns `{ error: <message> }` the caller can render,
  not a `console.log`-only void

#### Scenario: Paging action keeps throwing

- **WHEN** a `loadMore*` action fails
- **THEN** it throws and the client's `.catch` marks the feed
  exhausted/retryable — unchanged
