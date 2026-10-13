# Technical Gaps & Architectural Analysis (Gaps.md)

This document provides an objective analysis of current technical gaps, architectural limitations, and technical debt in the MC-Discord platform, along with recommended remediation strategies.

---

## 1. Storage & Media Delivery Architecture

### Gap 1.1: Worker Proxying vs. Direct Pre-Signed Uploads
- **Current State**: Files up to 500 MB are uploaded by piping the client HTTP request body through a Cloudflare Worker endpoint (`/upload`) to Cloudflare R2 (`env.R2_BUCKET.put(key, request.body)`).
- **Risk / Limitation**: Although streaming avoids Worker RAM out-of-memory crashes, long transfers remain tied to Worker execution limits and single TCP connections. Network drops mid-transfer require a complete re-upload from 0%.
- **Remediation**: Transition to an S3-compatible pre-signed upload URL model. The client requests a signed upload URL via a lightweight API call, then uploads directly to Cloudflare R2 using standard S3 multipart chunking.

### Gap 1.2: Lack of Adaptive Bitrate Streaming (HLS / DASH)
- **Current State**: Uploaded video files are saved and served directly as raw `.mp4` or `.webm` files via Cloudflare R2 CDN with HTTP Range headers.
- **Risk / Limitation**: Users on mobile connections or limited bandwidth face high latency and buffering when opening large 1080p video files (up to 500 MB).
- **Remediation**: Introduce an asynchronous transcoding pipeline (via Cloudflare Stream, AWS MediaConvert, or a background worker with FFmpeg) to generate multi-bitrate HLS playlists (`.m3u8` and fragmented `.ts`/`.m4s` segments).

### Gap 1.3: Client-Side FFmpeg WASM Compression Bypass
- **Current State**: Client-side video compression via `@ffmpeg/ffmpeg` WASM is bypassed for any file larger than 20 MB to protect browser tabs from memory freezing.
- **Risk / Limitation**: Files between 20 MB and 500 MB are stored entirely uncompressed and unoptimized, increasing R2 storage consumption and delivery bandwidth.
- **Remediation**: Shift heavy video transcoding entirely to a server-side background queue.

---

## 2. Database & Query Performance

### Gap 2.1: Full-Text Search Performance in Cloudflare D1
- **Current State**: Post search currently uses standard SQL wildcard filters (`caption LIKE ? OR description LIKE ?`).
- **Risk / Limitation**: As the posts table grows beyond thousands of records, wildcard pattern matching requires full table scans, resulting in elevated query latency and CPU consumption in SQLite.
- **Remediation**: Implement SQLite FTS5 (Full-Text Search) virtual tables in Cloudflare D1 with inverted index tokens for caption and description fields.

### Gap 2.2: On-the-Fly Hot Score Ranking Calculation
- **Current State**: The Hot Score formula is evaluated dynamically across all candidate rows on every `GET /posts?sort=hot` query execution.
- **Risk / Limitation**: Computing arithmetic engagement decay dynamically on every page load increases query latency under heavy concurrency.
- **Remediation**: Store a materialized `hotScore` column on the `posts` table, updated by database triggers or a periodic scheduled Worker cron job (e.g., every 10 minutes).

---

## 3. Security, Authentication & Reliability

### Gap 3.1: Firebase Token Lifetime vs. Long Upload Duration
- **Current State**: Firebase ID tokens expire after 60 minutes. An upload timeout of 600 seconds (10 minutes) is supported.
- **Risk / Limitation**: If a user selects a large 500 MB file when their active token has less than 10 minutes of remaining validity, the upload will complete client-side but fail server-side token validation upon arrival.
- **Remediation**: Force a token refresh via `currentUser.getIdToken(true)` immediately before initiating the XHR upload stream.

### Gap 3.2: Missing API Rate Limiting
- **Current State**: No rate limiting is configured on `/upload`, `/posts`, `/posts/like`, or `/posts/comments`.
- **Risk / Limitation**: A compromised account or malicious script can spam likes, post rapid duplicate entries, or exhaust storage quota with automated uploads.
- **Remediation**: Implement rate limiting per IP address and authenticated UID using Cloudflare Rate Limiting Rules or KV-backed sliding window counters.

### Gap 3.3: Absence of Automated Content Moderation
- **Current State**: Uploaded media is committed directly to public storage without pre-publication safety screening.
- **Risk / Limitation**: Upload of illicit, NSFW, or copyright-violating media could lead to domain blacklisting and platform abuse.
- **Remediation**: Implement an automated moderation checkpoint (e.g., Cloudflare Workers AI image classification or AWS Rekognition) before public visibility is granted.

---

## 4. Frontend Architecture & Codebase Maintainability

### Gap 4.1: Monolithic Script Files
- **Current State**: Core front-end logic is concentrated in large files (`public/js/gallery.js` exceeds 2,200 lines, `public/js/profile.js` exceeds 1,300 lines).
- **Risk / Limitation**: High coupling between DOM manipulation, network communication, authentication listeners, and state management makes testing and selective code updates prone to regression.
- **Remediation**: Modularize front-end JavaScript into dedicated ES6 modules (`modules/auth.js`, `modules/api.js`, `modules/lightbox.js`, `modules/upload.js`, `modules/masonry.js`).

### Gap 4.2: Shorts Comments Drawer Backend Connection
- **Current State**: The comment drawer UI on `shorts.html` is present, but interaction handlers show a static placeholder message.
- **Risk / Limitation**: Users expect parity between Shorts and Gallery comment functionality.
- **Remediation**: Wire the Shorts comment drawer to the existing `/posts/comments` endpoints and reuse the comment component renderer.
