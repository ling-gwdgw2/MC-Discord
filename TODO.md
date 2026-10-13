# Task Board & Immediate Action Items (TODO)

This document tracks immediate bug fixes, technical debt resolution, and short-term implementation tasks for the MC-Discord project.

---

## 1. High Priority / Hotfixes

- [ ] **Multipart / Chunked Upload for Media over 100 MB**
  - Current status: Large files are streamed through the Worker in a single HTTP request. If mobile connection drops mid-flight, the upload fails completely without resume capability.
  - Action: Implement presigned direct-to-R2 upload or chunked multipart upload handler to support upload resumption.

- [ ] **Firebase Auth Token Expiration During Long Uploads**
  - Current status: Upload timeout is set to 600 seconds (10 minutes). If a user's Firebase ID token is within minutes of its 1-hour expiration window when starting a 500 MB upload, authentication verification can fail upon completion.
  - Action: Proactively call `currentUser.getIdToken(true)` immediately before initiating the XHR upload to obtain a fresh token.

- [ ] **Complete Shorts Comment Drawer Integration**
  - Current status: The comments drawer in `shorts.html` displays static placeholder text ("ระบบความคิดเห็นสำหรับ Shorts เร็วๆ นี้").
  - Action: Connect the drawer to existing Worker endpoints (`GET /posts/comments` and `POST /posts/comments`), implement comment list rendering, and add delete support for comment authors.

---

## 2. Shorts Player Refinements

- [ ] **Mobile Swipe Velocity and Threshold Tuning**
  - Current status: Dependent on native CSS scroll snap (`scroll-snap-type: y mandatory`). On older Android devices, quick flick gestures can skip multiple reels.
  - Action: Add touch gesture listener to cap snap movements to single-item increments when fast flicks are detected.

- [ ] **Preload Next Reel Metadata**
  - Current status: Only current item and immediately adjacent items mount `src`.
  - Action: Preload the first 2 seconds or metadata buffer of `index + 1` video to minimize playback delay on swipe down.

- [ ] **Double-Tap to Like with Floating Heart Animation**
  - Action: Add double-tap detection on `.shorts-player-frame` that triggers `POST /posts/like` and renders a CSS heart particle effect.

---

## 3. Gallery & Post Creation Improvements

- [ ] **Client-Side File Type Whitelist Enforcement**
  - Current status: Files are checked via `file.type`, which can be blank or generic on some mobile file pickers.
  - Action: Validate file extensions (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.mp4`, `.webm`) alongside MIME type before initiating upload.

- [ ] **Upload Progress Bar Numeric Readout**
  - Current status: Progress bar width updates dynamically, but percentage text is only shown on the submit button.
  - Action: Add explicit percentage label and upload speed indicator (e.g., `42.5 MB / 180 MB - 6.2 MB/s`) inside the progress container.

- [ ] **Draft Preservation on Accidental Modal Close**
  - Current status: Clicking away or refreshing clears caption and description input.
  - Action: Cache caption and description to `sessionStorage` until successful post creation.

---

## 4. Backend & Storage Maintenance

- [ ] **Rate Limiting on Like and Comment Endpoints**
  - Current status: No per-IP or per-UID rate limits exist on `/posts/like` or `/posts/comments`.
  - Action: Use Cloudflare Workers KV or Cloudflare Rate Limiting rules to cap requests to 30 actions per minute per UID.

- [ ] **Automated Orphaned R2 Object Cleanup**
  - Current status: If a post is created on R2 but database insertion in D1 fails, the uploaded file remains in R2 indefinitely.
  - Action: Implement a scheduled Cloudflare Worker cron job to scan R2 buckets and purge unreferenced files older than 24 hours.

- [ ] **Database Backup and Migration Verification**
  - Action: Script automated daily D1 exports (`wrangler d1 export`) to a designated backup storage bucket.

---

## 5. Completed Tasks (Recent)

- [x] Implement direct stream upload from client to R2 via Cloudflare Worker (`request.body`).
- [x] Enforce 500 MB file size limit on both client and server sides.
- [x] Enforce Full HD (1920x1080) resolution recommendation check.
- [x] Fix CORS / OOM crash caused by `request.arrayBuffer()` buffer allocation in Worker.
- [x] Implement DOM virtualization for Shorts video reel to maintain low RAM footprint.
- [x] Add cursor-based infinite scrolling to Shorts video reel.
- [x] Implement lightweight video cover badge on Gallery masonry view (`preload="metadata"`).
