# Spec Delta

## Purpose

Shared-access invites become deliverable, owner-minted,
optionally email-bound, and expiry-aware.

## ADDED Requirements

### Requirement: Shared-access invites are deliverable and bound

`createInviteAction` SHALL return the invite URL and the
`/parent/profiles` pending list SHALL render it as a copyable
`<origin>/invite/<token>` link — the flow is unreachable while the
link only reaches a `console.log`. Only the profile's owner
(`profile.parentId === session.user.id`) SHALL mint invites — a
shared-access editor SHALL NOT. Expired invites SHALL be treated
like non-pending on the accept page and labeled "Expired" in the
pending list.

#### Scenario: Invite link reaches the inviter

- **WHEN** an owner creates an invite
- **THEN** the action returns the URL and a copyable link appears
  on the pending row

#### Scenario: Shared editor cannot mint invites

- **WHEN** a parent with `shared_access` (not ownership) calls the
  invite action
- **THEN** it is rejected

#### Scenario: Expired invite is not accept-able

- **WHEN** a visitor opens `/invite/<token>` past `expiresAt`
- **THEN** the page shows an expired state, not a live Accept
  button, and `acceptInvite` returns an error

#### Scenario: Email-bound acceptance (if kept per D3)

- **WHEN** an invite carries an email and a signed-in user accepts
- **THEN** acceptance requires `invite.email.toLowerCase() ===
  user.email`, else a "wrong account" error
