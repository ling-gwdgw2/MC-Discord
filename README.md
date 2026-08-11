# MC-Discord: Hatsune Miku Community Media Hub

MC-Discord is a high-performance web application and media sharing platform designed for community interaction, photo gallery browsing, vertical short video clips (Shorts), and user profiles. Built with a serverless backend architecture leveraging Cloudflare Workers, Cloudflare D1 SQLite Database, Cloudflare R2 Storage, and Firebase.

---

## Features

### 1. Photo Gallery & Masonry Grid
- Responsive Masonry grid layout for displaying community image and video uploads.
- Video preview cards featuring initial frame metadata loading and visual badges.
- Sorting options: Hot & Trending, Latest, and Most Liked.

### 2. Vertical Video Shorts Reel
- Full-screen vertical video feed with smooth touch snapping and wheel navigation.
- Deep-linking URL parameter parsing (`shorts.html?post=ID`) ensuring exact video positioning on direct access.
- Batch infinite scrolling with cursor-based pagination.

### 3. Rule-Based Hot Score Ranking System
- Dynamic content ranking formula executed directly inside Cloudflare D1 SQLite:
  `Hot Score = (Likes * 10,800,000) + (Comments * 18,000,000) + createdAt`
- Weighted engagement: Comments (+5 hours timestamp boost) and Likes (+3 hours timestamp boost).
- Ensures fresh, highly-engaged media ranks at the top while older posts naturally decay over time.

### 4. Client-Side Media Compression Pipeline
- **Image Compression**: Resizes uploaded images to a maximum of 1600x1600 pixels (400x400 for profile avatars) and converts them to optimized `.webp` format (0.8 quality).
- **Video Compression**: Re-encodes videos down to a maximum of 1080p Full HD using FFmpeg WASM with H.264 video codec (`-crf 28`, `-preset ultrafast`) and AAC audio (128kbps).
- **Safety Fallback**: Automatically preserves original files if browser memory limits or invalid formats prevent WASM processing, ensuring zero failed uploads.

### 5. Memory & DOM RAM Virtualization
- Unmounts off-screen video decoders (`video.removeAttribute('src'); video.load()`) when items move more than 1.5 viewports away from the active screen.
- Restores video sources dynamically when scrolling back into view.
- Keeps browser RAM consumption below 50MB on low-memory mobile devices (iOS Safari and Android Chrome).

---

## System Architecture

- **Frontend**: HTML5, Vanilla CSS3, JavaScript (ES6+), Firebase Auth, FontAwesome.
- **Backend API**: Cloudflare Workers (`index.js`).
- **Database**: Cloudflare D1 (Serverless SQLite).
- **Media Storage**: Cloudflare R2 Object Storage (S3-compatible API).
- **Caching Layer**: Cloudflare KV Namespace.
- **Hosting**: Firebase Hosting (`https://garden-of-dreams-4768a.web.app`).

---

## API Endpoints

- `GET /posts` - Fetch media posts with support for pagination (`cursor`), sorting (`hot`, `date`, `likes`), and search filters.
- `POST /posts` - Create a new media post entry linked to Cloudflare R2 storage.
- `DELETE /posts` - Remove a post owned by the authenticated user.
- `POST /upload` - Proxy authenticated media uploads directly to Cloudflare R2.
- `POST /likes` - Toggle post like status.
- `GET /comments` & `POST /comments` - Retrieve and submit comments for posts.
- `GET /notifications` - Retrieve user interaction notifications (follows, likes, comments).

---

## Local Development & Deployment

### Prerequisites
- Node.js (v18+)
- Wrangler CLI (`npm install -g wrangler`)
- Firebase CLI (`npm install -g firebase-tools`)

### Run Locally
```bash
npm run dev
```

### Deploy Backend (Cloudflare Workers)
```bash
cd cloudflare-worker
npx wrangler deploy
```

### Deploy Frontend (Firebase Hosting)
```bash
npx firebase deploy --only hosting
```