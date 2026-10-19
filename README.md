# NibrasTube - Safe Video Platform for Kids

NibrasTube is a parent-curated, restricted video playground for children. Parents approve specific YouTube videos and kids can only watch what has been whitelisted.

## 🚀 Features

- **Parent Portal**:
  - Secure parent authentication (JWT-based).
  - **Manage Kids**: Create and curate content for multiple children (including set/reset Child PINs).
  - **Playlists**: Organize videos into custom playlists for better categorization.
  - **Parent PIN**: 4-digit security PIN for administrative control and profile management.
  - Global YouTube search via API.
  - One-click approval (Pinning) of safe videos.
  - Shared management: Invite other parents and accept invites via secure tokens.
  - **Logout**: Securely sign out of the parent dashboard.
- **Kids Portal**:
  - **Authenticated Access**: Protected route requiring Parent login.
  - **Who's Watching?**: Parent-scoped profile selection based on the logged-in account.
  - **PIN Protected**: Profile entry requires Parent or Child PIN (Default: 0000); switching profiles is locked behind the Parent PIN.
  - **Restricted Content Grid**: Only approved videos, organized by parent-created **Playlists**.
  - Internal search within the whitelist.
  - Kid-friendly video player (minimal controls, no ads/distractions).
- **Real-time Sync**:
  - Instant updates to the kids' portal using **Pusher** when content is approved or removed.

## 🛠️ Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Authentication**: JWT (jose) + Bcrypt
- **Real-time**: [Pusher](https://pusher.com/)
- **UI Components**: [Shadcn/UI](https://ui.shadcn.com/) + Tailwind CSS
- **Icons**: [Phosphor Icons](https://phosphoricons.com/)

## ⚙️ Environment Setup

Create a `.env` file in the root directory:

```env
DATABASE_URL=postgresql://user:pass@host:port/dbname
DATABASE_URL_UNPOOLED=postgresql://user:pass@host:port/dbname
JWT_SECRET=your_secret_here
YOUTUBE_API_KEY=your_google_api_key
PUSHER_APP_ID=...
PUSHER_KEY=...
PUSHER_SECRET=...
PUSHER_CLUSTER=...
```

## 🏁 Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Push Database Schema**:
   ```bash
   npx drizzle-kit push
   ```

3. **Run Development Server**:
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
