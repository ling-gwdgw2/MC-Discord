# Project Roadmap

This roadmap outlines the planned development trajectory and strategic milestones for the MC-Discord platform across future phases.

---

## Phase 1: Media Pipeline & Storage Optimization (Q4 2026)

### 1.1 Direct Pre-Signed URL Uploads (R2)
- Transition from proxying uploads through Cloudflare Worker to direct-to-R2 pre-signed PUT URLs using S3-compatible credentials.
- Reduces Worker runtime bandwidth and eliminates single-worker stream transfer limitations.
- Enables resumable multipart uploads for files up to 500 MB.

### 1.2 Adaptive Bitrate Video Delivery (HLS / DASH)
- Implement asynchronous video transcoding pipeline using Cloudflare Stream or an external worker queue.
- Convert 1080p source uploads into multi-resolution streams (360p, 720p, 1080p).
- Deliver video playback via HLS (`.m3u8`) to allow smooth playback under weak cellular networks without buffering large raw MP4 files.

---

## Phase 2: Wiki Mod Project & Freeform Canvas Builder (Q1 2027)

### 2.1 System Architecture & Data Schema
- **Database Architecture (Cloudflare D1)**:
  - Table `wiki_pages`: `id`, `slug`, `title`, `category`, `modVersion`, `bannerUrl`, `layoutData` (JSON string containing component coordinates, styles, and content), `isPublished`, `createdBy`, `updatedAt`.
  - Table `admin_users`: `userId`, `role` (`superadmin`, `editor`), `addedBy`, `createdAt`.
- **Media Asset Pipeline (Cloudflare R2)**:
  - Dedicated R2 bucket path prefix (`wiki/images/`, `wiki/icons/`) for mod screenshots, item textures, and entity models.
  - Integration with existing authenticated Worker upload pipeline.

### 2.2 Freeform Canvas Engine (Admin Editor)
- **Visual Drag-and-Drop Workspace (`wiki-editor.html`)**:
  - Two-dimensional infinite canvas supporting arbitrary X/Y coordinate placement.
  - Configurable Grid-Snap system (Off, 8px, 16px, 32px) for structured pixel alignment.
  - Multi-handle bounding boxes supporting real-time resizing, aspect-ratio locking, and rotation.
  - Multi-layer management with Z-Index ordering (Bring Forward, Send Backward, Bring to Front, Send to Back).
  - Canvas state history engine enabling non-destructive Undo and Redo operations.
- **Modular Component Palette**:
  - Heading & Rich Text Blocks: Font sizing, custom web fonts, text color, background fills, padding, borders, and Markdown support.
  - Media & Image Blocks: Aspect ratio adjustments, border radiuses, drop shadows, and direct Cloudflare R2 uploads.
  - Minecraft 3x3 Crafting Grid Block: Interactive crafting table preview with item tooltips and recipe results.
  - Mod Entity & Item Stat Cards: Structured attribute tables for health, attack damage, armor values, drop rates, and spawn biomes.
  - Code & Config Block: Syntax-highlighted code container for mod configurations (`JSON`, `TOML`, `Java`).

### 2.3 Public Wiki Viewer & Responsive Rendering Engine
- **Public Viewer (`wiki.html`)**:
  - Left-hand category tree navigation (Items, Mobs, World Generation, Mechanics, Crafting Recipes).
  - Client-side full-text and category search filtering.
  - Fast DOM compilation directly from `layoutData` JSON without client-side framework overhead.
  - Sticky table of contents generated dynamically from heading nodes.
- **Responsive Flow Engine (Mobile Adaptation)**:
  - Dynamic viewport detection for mobile screens (< 768px).
  - Mathematical transformation converting absolute 2D canvas coordinates (X, Y) into a linearized auto-flow layout ordered by primary Y-axis position and Z-Index precedence, preventing text truncation and off-screen horizontal overflowing.

### 2.4 Security & Role-Based Access Control (RBAC)
- **Backend Verification**:
  - Endpoints `POST /wiki/page`, `PUT /wiki/page/:slug`, and `DELETE /wiki/page/:slug` enforced through `verifyFirebaseToken()`.
  - Database verification querying `admin_users` table by authenticated UID before permitting page mutations or image publications.
- **Frontend Protection**:
  - Editor view restricted via token claims; unauthorized users redirected automatically to the public reader view.

---

## Phase 3: Interactive Community & Social Engagement (Q2 2027)

### 3.1 Real-Time Comments & Live Reactions
- Introduce Cloudflare Durable Objects and WebSockets for real-time comment synchronization without page refresh.
- Support nested replies and threaded conversations on both Gallery posts and Shorts reels.
- Add live floating reaction counters during Shorts playback.

### 3.2 Creator Profiles & Social Graph Expansion
- Add customized creator banners, social media links, and bio formatting.
- Implement categorized profile tabs: All Posts, Videos Only, Liked Posts, and Saved Collections.
- Add user-to-user blocking and mute capabilities.

---

## Phase 4: Platform Safety & Content Moderation (Q3 2027)

### 4.1 Automated Media Content Filtering
- Integrate Cloudflare Workers AI or external vision models to detect explicit, violent, or copyrighted content before public publishing.
- Implement perceptual hash matching (pHash) to detect duplicate spam uploads.

### 4.2 Reporting & Administrative Management
- Provide user-facing report modals on posts and comments with standardized category selection.
- Build an authenticated administrator moderation portal with options to hide, flag, or delete posts and suspend accounts.
- Audit logging for all administrative moderation actions.

---

## Phase 5: Discovery, Search & Content Intelligence (Q4 2027)

### 5.1 Full-Text Search & Tag Indexing
- Upgrade Cloudflare D1 post schema to include SQLite FTS5 (Full-Text Search) virtual tables.
- Enable instant auto-complete search across post titles, descriptions, and creator handles.
- Add hashtag extraction (`#minecraft`, `#miku`) with dedicated tag discovery pages.

### 5.2 Recommendation & Personalization Engine
- Expand the current arithmetic Hot Score formula to factor in view completion rate, repeat views, and creator engagement affinity.
- Implement a dedicated "For You" feed alongside the existing "Explore" and "Following" tabs.

---

## Phase 6: Progressive Web App (PWA) & Mobile Enhancements (Q1 2028)

### 6.1 Offline & Caching Capabilities
- Deploy Service Worker caching for core application shell assets, fonts, and recent posts.
- Provide offline viewing for saved media collections and downloaded wiki documentation.

### 6.2 Native-Like App Experience
- Implement Web App Manifest (`manifest.json`) for home-screen installation on iOS and Android.
- Integrate Web Push Notifications API for follow events, likes, and comment replies.
- Native share sheet integration via `navigator.share()` API.
