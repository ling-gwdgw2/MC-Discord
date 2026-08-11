// Shorts Reel Dedicated Script สคริปต์แยกอิสระสำหรับควบคุมระบบ Shorts Reel แนวตั้ง

let loadedShortsList = [];
let activeVideoElement = null;

window.addEventListener('DOMContentLoaded', () => {
    // Initial Auth State and Posts load
    if (typeof firebase !== 'undefined') {
        firebase.auth().onAuthStateChanged(user => {
            updateHeaderProfile(user);
            loadShortsFeed();
        });
    } else {
        loadShortsFeed();
    }

    // Bind Navigation links
    const profileBtn = document.getElementById('nav-profile-btn');
    if (profileBtn) {
        profileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                openAuthModal('login');
                showMikuToast("Please log in to view profile!", "error");
            } else {
                window.location.href = 'profile.html';
            }
        });
    }

    const createPostBtn = document.getElementById('nav-create-post-btn');
    if (createPostBtn) {
        createPostBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                openAuthModal('login');
                showMikuToast("Please log in to upload videos!", "error");
            } else {
                window.location.href = 'gallery.html?action=create';
            }
        });
    }
});

async function loadShortsFeed() {
    const feedContainer = document.getElementById('shorts-feed-container');
    if (!feedContainer) return;

    try {
        const headers = {};
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
            const idToken = await currentUser.getIdToken();
            headers['Authorization'] = `Bearer ${idToken}`;
        }

        // Fetch all video posts from Cloudflare Worker
        const res = await fetch(`${WORKER_URL}/posts?limit=50`, { headers });
        if (!res.ok) throw new Error("Failed to fetch posts for Shorts reel");
        
        const resData = await res.json();
        const allPosts = resData.posts || [];
        
        // Filter strictly for video posts (.mp4, .webm)
        loadedShortsList = allPosts.filter(p => {
            const url = (p.imageUrl || '').toLowerCase();
            return url.endsWith('.mp4') || url.endsWith('.webm');
        });

        feedContainer.innerHTML = '';

        if (loadedShortsList.length === 0) {
            feedContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #ffffff; text-align: center; padding: 20px;">
                    <i class="fa-solid fa-film" style="font-size: 48px; color: var(--primary-cyan); margin-bottom: 16px;"></i>
                    <h2 style="margin-bottom: 8px;">ยังไม่มี Shorts ในขณะนี้</h2>
                    <p style="color: rgba(255,255,255,0.7); max-width: 400px; margin-bottom: 20px;">ร่วมแชร์วิดีโอคลิปสั้นของคุณเพื่อรับชมคลิปบนหน้า Shorts Reel ได้ก่อนใคร!</p>
                    <a href="gallery.html?action=create" class="btn btn-solid" style="background: var(--primary-cyan); border: none; border-radius: 20px; color: #ffffff;">แชร์คลิปวิดีโอแรกเลย 🎬</a>
                </div>
            `;
            return;
        }

        // Render each Shorts reel item
        loadedShortsList.forEach((post, index) => {
            const reelItem = createShortsReelItem(post, index);
            feedContainer.appendChild(reelItem);
        });

        // Setup Intersection Observer for Vertical Video Auto-play
        setupShortsIntersectionObserver();

    } catch (err) {
        console.error("Shorts feed error:", err);
        if (feedContainer) {
            feedContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #ffffff;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 40px; color: #e11d48; margin-bottom: 12px;"></i>
                    <span>เกิดข้อผิดพลาดในการโหลดวิดีโอ Shorts</span>
                </div>
            `;
        }
    }
}

function createShortsReelItem(post, index) {
    const item = document.createElement('div');
    item.className = 'shorts-reel-item';
    item.dataset.index = index;
    item.dataset.postId = post.id;

    const currentUser = firebase.auth().currentUser;
    const currentUid = currentUser ? currentUser.uid : null;
    const likesArray = post.likes || [];
    const isLiked = currentUid && likesArray.includes(currentUid);
    const likedClass = isLiked ? 'liked' : '';
    const heartIcon = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    const likesCount = likesArray.length;
    const postDate = typeof formatTimeAgo === 'function' ? formatTimeAgo(post.createdAt) : 'Recently';

    let authorAvatarHtml = '';
    if (post.authorAvatar) {
        authorAvatarHtml = `<img src="${escapeHtml(post.authorAvatar)}" alt="${escapeHtml(post.authorName || '')}">`;
    } else {
        const initials = (post.authorName || 'M').substring(0, 2).toUpperCase();
        authorAvatarHtml = `<div class="lightbox-author-initials">${initials}</div>`;
    }

    const canDownload = post.allowDownload === 1 || (currentUser && currentUser.uid === post.authorId);
    const saveBtnHtml = canDownload 
        ? `<button class="shorts-action-btn shorts-save-btn" title="ดาวน์โหลดวิดีโอ">
            <i class="fa-solid fa-download"></i>
           </button>`
        : '';

    item.innerHTML = `
        <div class="shorts-player-frame">
            <video src="${escapeHtml(post.imageUrl)}" class="shorts-media-element" id="shorts-video-${index}" loop playsinline></video>
            
            <div class="shorts-gradient-overlay"></div>

            <!-- Top Left Mobile Back Button -->
            <button class="shorts-back-btn" title="Back" aria-label="Back">
                <i class="fa-solid fa-arrow-left"></i>
            </button>

            <!-- Bottom Left Creator Overlay -->
            <div class="shorts-bottom-info">
                <div class="shorts-creator-row">
                    ${authorAvatarHtml}
                    <span class="shorts-creator-name">${escapeHtml(post.authorName || 'Anonymous')}</span>
                    <button class="shorts-subscribe-btn">Subscribe</button>
                </div>
                <h1 class="shorts-title">${escapeHtml(post.caption || 'Untitled')}</h1>
                <p class="shorts-description">${escapeHtml(post.description || '')}</p>
                <span class="shorts-time">${postDate}</span>
            </div>

            <!-- Right Side Floating Action Buttons -->
            <div class="shorts-action-bar">
                <div class="shorts-action-item">
                    <button class="shorts-action-btn post-card-like-btn ${likedClass}" id="shorts-like-${index}">
                        <i class="${heartIcon}"></i>
                    </button>
                    <span class="shorts-action-count">${likesCount}</span>
                </div>

                <div class="shorts-action-item">
                    <button class="shorts-action-btn shorts-comment-btn">
                        <i class="fa-regular fa-comment-dots"></i>
                    </button>
                    <span class="shorts-action-count">ความคิดเห็น</span>
                </div>

                <div class="shorts-action-item">
                    <button class="shorts-action-btn shorts-share-btn">
                        <i class="fa-solid fa-share"></i>
                    </button>
                    <span class="shorts-action-count">แชร์</span>
                </div>

                <div class="shorts-action-item">
                    <button class="shorts-action-btn shorts-sound-btn">
                        <i class="fa-solid fa-volume-high"></i>
                    </button>
                </div>

                ${saveBtnHtml ? `<div class="shorts-action-item">${saveBtnHtml}</div>` : ''}
            </div>

            <!-- Comment Drawer -->
            <div class="shorts-comments-drawer" style="display: none;">
                <div class="shorts-drawer-header">
                    <h3>ความคิดเห็น (Comments)</h3>
                    <button class="shorts-drawer-close-btn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="lightbox-comments-list" style="flex: 1; overflow-y: auto; padding: 10px 0;">
                    <div style="font-style: italic; color: #888;">ไม่มีความคิดเห็นในขณะนี้ เริ่มการสนทนาเลย!</div>
                </div>
                <div class="lightbox-comment-input-row" style="display: flex; gap: 8px; margin-top: 8px;">
                    <input type="text" class="lightbox-comment-input" placeholder="ใส่ความคิดเห็น..." style="flex: 1; padding: 8px 12px; border-radius: 20px; border: 1px solid #ccc;">
                </div>
            </div>
        </div>
    `;

    // Event Bindings for player controls
    const videoEl = item.querySelector('video');
    const backBtn = item.querySelector('.shorts-back-btn');
    const soundBtn = item.querySelector('.shorts-sound-btn');
    const likeBtn = item.querySelector('.post-card-like-btn');
    const dislikeBtn = item.querySelector('.shorts-dislike-btn');
    const shareBtn = item.querySelector('.shorts-share-btn');
    const commentBtn = item.querySelector('.shorts-comment-btn');
    const commentDrawer = item.querySelector('.shorts-comments-drawer');
    const drawerCloseBtn = item.querySelector('.shorts-drawer-close-btn');

    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = 'gallery.html';
            }
        });
    }

    // Click on video frame to Play / Pause
    const frame = item.querySelector('.shorts-player-frame');
    if (frame && videoEl) {
        frame.addEventListener('click', (e) => {
            if (e.target.closest('.shorts-action-btn') || e.target.closest('.shorts-back-btn') || e.target.closest('.shorts-subscribe-btn') || e.target.closest('.shorts-comments-drawer')) return;
            if (videoEl.paused) {
                videoEl.play();
            } else {
                videoEl.pause();
            }
        });
    }

    // Toggle Sound (Mute / Unmute)
    if (soundBtn && videoEl) {
        soundBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            videoEl.muted = !videoEl.muted;
            const icon = soundBtn.querySelector('i');
            if (icon) {
                icon.className = videoEl.muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
            }
            showMikuToast(videoEl.muted ? "ปิดเสียงวิดีโอแล้ว 🔇" : "เปิดเสียงวิดีโอ 🔊", "info");
        });
    }

    // Toggle Like
    if (likeBtn) {
        likeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (typeof toggleLike === 'function') {
                await toggleLike(post.id, e);
            }
        });
    }

    // Dislike Button
    if (dislikeBtn) {
        dislikeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const icon = dislikeBtn.querySelector('i');
            const isDisliked = dislikeBtn.classList.toggle('disliked');
            if (icon) {
                icon.className = isDisliked ? 'fa-solid fa-thumbs-down' : 'fa-regular fa-thumbs-down';
            }
            showMikuToast("ขอบคุณสำหรับข้อเสนอแนะของคุณ! 🙏", "success");
        });
    }

    // Share Button
    if (shareBtn) {
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const shareUrl = `${window.location.origin}/shorts.html?post=${post.id}`;
            navigator.clipboard.writeText(shareUrl).then(() => {
                showMikuToast("คัดลอกลิงก์แชร์ Shorts แล้ว! 📋", "success");
            }).catch(() => {
                showMikuToast("ไม่สามารถคัดลอกลิงก์ได้", "error");
            });
        });
    }

    // Comment Drawer Toggle
    if (commentBtn && commentDrawer) {
        commentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = commentDrawer.style.display === 'flex';
            commentDrawer.style.display = isOpen ? 'none' : 'flex';
        });
    }

    if (drawerCloseBtn && commentDrawer) {
        drawerCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            commentDrawer.style.display = 'none';
        });
    }

    return item;
}

function setupShortsIntersectionObserver() {
    const items = document.querySelectorAll('.shorts-reel-item');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
                // Pause previously active video
                if (activeVideoElement && activeVideoElement !== video) {
                    activeVideoElement.pause();
                }
                activeVideoElement = video;
                
                // Attempt to play unmuted video first, fallback to muted if browser blocks unmuted autoplay
                video.play().catch(() => {
                    video.muted = true;
                    const soundBtn = entry.target.querySelector('.shorts-sound-btn i');
                    if (soundBtn) soundBtn.className = 'fa-solid fa-volume-xmark';
                    video.play().catch(err => console.log("Autoplay prevented:", err));
                });
            } else {
                video.pause();
            }
        });
    }, {
        threshold: 0.6 // Video must be >60% visible to trigger autoplay
    });

    items.forEach(item => observer.observe(item));
}
