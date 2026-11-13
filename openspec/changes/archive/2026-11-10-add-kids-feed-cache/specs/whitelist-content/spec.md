# Spec Delta

## ADDED Requirements

### Requirement: Removals cannot be undone by cached feed data

When a parent unpins or blocks a video, or un-approves a channel,
the mutation SHALL invalidate that profile's cached feed and
watch-queue entries before responding, so a removed video cannot
be served from cache to an open kid session on the next read.
The cached TTL window SHALL NOT extend the lifetime of removed
content.

#### Scenario: Unpinned video is gone on the next read

- **WHEN** a parent unpins a video while a cached feed entry
  exists for that profile
- **THEN** the very next feed or watch read for the profile
  recomputes without the removed video

#### Scenario: Un-approved channel's videos vanish together

- **WHEN** a parent un-approves a channel while cached feed
  entries exist for the profile
- **THEN** the next read recomputes and none of the channel's
  auto-added videos are served from stale cache
