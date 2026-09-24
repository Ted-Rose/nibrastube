# NibrasTube Product Requirements Document (PRD)

## 1. Product Vision

NibrasTube aims to provide a 100% safe, parent-curated video experience for children. Unlike traditional YouTube Kids, where algorithms decide appropriateness, NibrasTube gives parents the power to whitelist specific videos for their kids, ensuring zero exposure to unintended content.

## 2. Target Audience

- **Parents** who are concerned about YouTube's automated content filtering.
- **Children (Ages 2-12)** who want to browse and watch their favorite shows in a safe environment.
- **Caregivers/Educators** who want to curate educational playlists for children.

## 3. Key Features

### 3.1 Parent Portal

- [x] **Secure Authentication**: Parents create an account via Email/Password or Social Login.
- [x] **Manage Kids**: Create multiple entries for children with custom names, avatars, and a 4-digit Kid PIN (Default: 0000).
- [ ] **Parental Controls**: Manage and reset Child PINs from the parent dashboard.
- [ ] **Playlists**: Create and manage custom playlists (e.g., "Learning", "Cartoons") for each child.
- [x] **Shared Management**: Invite another parent (e.g., spouse) to manage the same kids.
- **Whitelisting (The "Pin" Feature)**:
  - [x] Search global YouTube via the YouTube Data API.
  - [x] Preview videos before approving.
  - [x] Pin videos to one or more kids and assign them to specific playlists.
  - [x] Approve entire YouTube channels — existing uploads are backfilled and new uploads sync daily.
- [x] **Dashboard**: View what each kid is watching and manage the approved list.

### 3.2 Kids Portal

- [x] **Authenticated Access**: The Kids Portal (`/kids`) is a protected route requiring a valid Parent login.
- [x] **Parent-Scoped Profiles**: Parents can only see and access kids' profiles associated with their own account (or shared with them).
- [x] **Whitelisted Content Grid**: A simple, visual grid of ONLY the videos pinned by parents.
- [ ] **Playlist Browsing**: Kids can browse their approved content organized by playlists created by their parents.
- [x] **Internal Search**: Kids can search _only_ within their approved list of videos.
- **Child Safety & Restrictions**:
    - [ ] **Profile Entrance Control**: Entering a kid profile requires either the 4-digit Parent PIN or the profile's specific 4-digit Kid PIN.
    - [x] **Profile Isolation & Switching**: Kids are locked to their assigned profile; switching profiles or accessing any `/parent` route requires the secure 4-digit Parent PIN.
    - [ ] **Restricted Player**: YouTube branding and "Watch on YouTube" links are hidden to keep kids within the safe environment.
    - [x] **No Data Leakage**: No access to global YouTube search, related videos, or engagement features (comments/likes).
- [x] **Kid-Friendly Player**: Simplified playback controls (Play/Pause, Seek).

## 4. User Flows

### Flow A: Parent Setup

1. Parent signs up.
2. Parent creates a kid profile ("Adam").
3. Parent searches for "Blippi" on the Parent Portal.
4. Parent pins 5 Blippi videos to "Adam".

### Flow B: Child Viewing

1. Child opens the app and selects their profile ("Adam").
2. Child sees the 5 Blippi videos approved by the parent.
3. Child uses the search bar to find "Construction trucks" among the 5 videos.
4. Child watches an approved video.

### Flow C: Shared Management

1. Parent A (Husband) invites Parent B (Wife) to manage "Adam" via email on the **Manage Kids** page.
2. Parent A shares the generated **Invitation Link** with Parent B.
3. Parent B visits the link, logs in, and clicks **Accept Invitation**.
4. Parent B now sees "Adam" in their dashboard and can pin/unpin videos.

## 5. Technical Requirements

### 5.1 Technology Stack

- **Unified Framework**: Next.js (App Router) - Handles both Frontend and API.
- **Database**: PostgreSQL (via Drizzle ORM).
- **Styling/UI**: Tailwind CSS + Shadcn/UI.
- **Video Playback**: YouTube IFrame API (Restricted Mode).
- **Real-time Sync**: Pusher (Triggered via Server Actions).

### 5.2 Performance & Reliability

- **Real-time Sync**: Use WebSockets or frequent polling to update the kid's portal when a parent pins a new video.
- **Security**: JWT-based authentication for parents; Profile-based session for kids.

## 6. Future Roadmap

- **Screen Time Limits**: Parents can set daily viewing quotas.
- **Sleep Mode**: Automatically lock the kids portal after a certain hour.
- **Category Tags**: Parents can organize pinned videos into categories (e.g., "Learning", "Shows").
