# Changelog

All notable changes to the MC-Discord project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

---

## [1.4.0] - 2026-08-12

### Added
- Direct stream upload support in Cloudflare Worker (`request.body` to R2 bucket) to eliminate worker RAM buffer allocation.
- Hard file size limit enforcement of 500 MB across client and server boundaries.
- Full HD resolution check (1920x1080) with client warning dialogs on larger media files.
- Visual dropzone indicators displaying updated upload constraints (Max 500 MB, Full HD 1080p).

### Fixed
- Resolved `Network error during file upload / CORS configuration error` caused by worker RAM out-of-memory (OOM) crashes during large file uploads.
- Corrected request body handling in Cloudflare Worker by replacing `request.arrayBuffer()` with direct readable stream piping.
- Added pre-emptive `Content-Length` validation to reject oversized payloads before data transfer begins.

---

## [1.3.0] - 2026-08-11

### Added
- Infinite scrolling with cursor-based pagination (`cursor` query parameter) in Shorts video reel.
- IntersectionObserver-based DOM virtualization for Shorts video players:
  - Videos outside a 150% viewport margin are unmounted (`video.removeAttribute('src')` and `video.load()`) to purge GPU decoders and browser memory.
  - Video sources are dynamically remounted from `data-src` when scrolled back into proximity.
- Loading sentinel and animated spinner component for seamless content retrieval.
- Deep-linking URL parameter handler (`shorts.html?post=ID`) to open specific videos directly with correct positioning.
- Interactive like button with backend synchronization in Shorts viewer.

### Changed
- Refactored Shorts feed to fetch items in batches of 10 items instead of a single 50-item query.
- Pure black background (`#000000`) applied across all Shorts containers and player frames.
- Removed text labels under action buttons (comment, share) for a minimalist layout.
- Removed manual audio mute/unmute button; playback state is governed by browser autoplay policy.

### Performance
- Video cover optimization on Gallery page: replaces full video playback in masonry view with static first-frame thumbnail capture (`preload="metadata"` with `#t=0.1`) and play badge overlay.
- Reduced memory consumption during continuous Shorts browsing from over 500 MB to under 50 MB on mobile browsers.

---

## [1.2.0] - 2026-08-05

### Added
- Universal dynamic video aspect-ratio calculation supporting any aspect ratio (1:1, 4:3, 4:5, 16:9, 9:16, 21:9).
- Flexbox vertical centering for horizontal and landscape videos on mobile viewports.
- Desktop Shorts TikTok-style vertical navigation sidebar (240px width).
- Mobile bottom action bar and metadata info elevation to prevent overlap with phone gesture bars.

### Fixed
- Fixed mobile video cropping by enforcing `object-fit: contain !important` and removing global mobile padding overrides on `body.shorts-page-body`.
- Removed frame border-radius and hidden gradient overlays to provide seamless edge-to-edge video presentation.

---

## [1.1.0] - 2026-07-28

### Added
- Rule-based Hot Score ranking formula calculated in Cloudflare D1 SQLite:
  `Hot Score = (Likes * 10,800,000) + (Comments * 18,000,000) + createdAt`
- Weighted decay mechanism: Comments provide +5 hours boost, Likes provide +3 hours boost.
- Follow and unfollow system with bi-directional count caching (`user_follows` table).
- Notification center with unread badge counter for likes, comments, and follows.
- User profile page with follower/following statistics, avatar customization, and individual upload galleries.

### Changed
- Replaced SQLite `LOG10` calls with pure arithmetic calculations to ensure full compatibility with Cloudflare D1 SQL engine.
- Switched video client-side compression to bypass files larger than 20 MB, preventing browser tab freezes and WASM memory limits.

---

## [1.0.0] - 2026-07-15

### Added
- Initial release of MC-Discord Community Media Hub.
- Masonry gallery layout for image and video showcase.
- Full-screen vertical Shorts player with touch and wheel snapping.
- User authentication via Firebase Auth (Google and email providers).
- Serverless API hosted on Cloudflare Workers.
- Database storage powered by Cloudflare D1 (SQLite).
- Media storage powered by Cloudflare R2 object storage.
- Edge caching powered by Cloudflare KV namespace.
