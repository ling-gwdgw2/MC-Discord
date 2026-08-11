// Shorts Reel Dedicated Script สคริปต์แยกอิสระสำหรับควบคุมระบบ Shorts Reel แนวตั้ง

let loadedShortsList = [];
let activeVideoElement = null;
let shortsCursor = null;
let isFetchingShorts = false;
let hasMoreShorts = true;

let autoplayObserver = null;
let virtualizationObserver = null;
let infiniteScrollObserver = null;

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

    // Reset pagination state
    shortsCursor = null;
    isFetchingShorts = false;
    hasMoreShorts = true;
    loadedShortsList = [];

    try {
        const headers = {};
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
            const idToken = await currentUser.getIdToken();
            headers['Authorization'] = `Bearer ${idToken}`;
        }

        // Fetch initial batch of 10 video posts sorted by Rule-Based Hot Score
        const res = await fetch(`${WORKER_URL}/posts?limit=10&sort=hot`, { headers });
        if (!res.ok) throw new Error("Failed to fetch posts for Shorts reel");
        
        const resData = await res.json();
        const allPosts = resData.posts || [];
        
        // Filter strictly for video posts (.mp4, .webm)
        loadedShortsList = allPosts.filter(p => {
            const url = (p.imageUrl || '').toLowerCase();
            return url.endsWith('.mp4') || url.endsWith('.webm');
        });

        // Parse target post ID from URL parameters (e.g. shorts.html?post=ID)
        const urlParams = new URLSearchParams(window.location.search);
        const targetPostId = urlParams.get('post') || urlParams.get('postId') || urlParams.get('id');

        if (targetPostId) {
            const targetIndex = loadedShortsList.findIndex(p => p.id === targetPostId);
            if (targetIndex > 0) {
                const [targetPost] = loadedShortsList.splice(targetIndex, 1);
                loadedShortsList.unshift(targetPost);
            } else if (targetIndex === -1) {
                try {
                    const singleRes = await fetch(`${WORKER_URL}/posts?postId=${encodeURIComponent(targetPostId)}`, { headers });
                    if (singleRes.ok) {
                        const singleData = await singleRes.json();
                        if (singleData.success && singleData.post) {
                            loadedShortsList.unshift(singleData.post);
                        }
                    }
                } catch (singleErr) {
                    console.warn("Failed to fetch target post for Shorts reel:", singleErr);
                }
            }
        }

        feedContainer.innerHTML = '';

        if (loadedShortsList.length === 0) {
            feedContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #ffffff; text-align: center; padding: 20px;">
                    <i class="fa-solid fa-film" style="font-size: 48px; color: var(--primary-cyan); margin-bottom: 16px;"></i>
                    <h2 style="margin-bottom: 8px;">ยังไม่มี Shorts ในขณะนี้</h2>
                    <p style="color: rgba(255,255,255,0.7); max-width: 400px; margin-bottom: 20px;">ร่วมแชร์วิดีโอคลิปสั้นของคุณเพื่อรับชมคลิปบนหน้า Shorts Reel ได้ก่อนใคร!</p>
                    <a href="gallery.html?action=create" class="btn btn-solid" style="background: var(--primary-cyan); border: none; border-radius: 20px; color: #ffffff;">แชร์คลิปวิดีโอแรกเลย</a>
                </div>
            `;
            return;
        }

        // Set cursor to the last post's timestamp
        shortsCursor = loadedShortsList[loadedShortsList.length - 1].createdAt;

        // Render each Shorts reel item
        loadedShortsList.forEach((post, index) => {
            const reelItem = createShortsReelItem(post, index);
            feedContainer.appendChild(reelItem);
        });

        // Append infinite scroll loading sentinel
        const sentinel = document.createElement('div');
        sentinel.id = 'shorts-loading-sentinel';
        sentinel.className = 'shorts-loading-sentinel';
        sentinel.innerHTML = `<div class="shorts-loading-spinner"></div>`;
        feedContainer.appendChild(sentinel);

        // Setup Virtualization and Autoplay Observers
        setupShortsObservers();

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

async function fetchMoreShorts() {
    if (isFetchingShorts || !hasMoreShorts) return;
    isFetchingShorts = true;

    const feedContainer = document.getElementById('shorts-feed-container');
    const sentinel = document.getElementById('shorts-loading-sentinel');
    if (sentinel) sentinel.style.display = 'flex';

    try {
        const headers = {};
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
            const idToken = await currentUser.getIdToken();
            headers['Authorization'] = `Bearer ${idToken}`;
        }

        const cursorQuery = shortsCursor ? `&cursor=${shortsCursor}` : '';
        const res = await fetch(`${WORKER_URL}/posts?limit=10&sort=hot${cursorQuery}`, { headers });
        if (!res.ok) throw new Error("Failed to fetch more shorts");

        const resData = await res.json();
        const posts = resData.posts || [];
        const videoPosts = posts.filter(p => {
            const url = (p.imageUrl || '').toLowerCase();
            return (url.endsWith('.mp4') || url.endsWith('.webm')) && !loadedShortsList.some(existing => existing.id === p.id);
        });

        if (videoPosts.length === 0) {
            hasMoreShorts = false;
            if (sentinel) sentinel.style.display = 'none';
            isFetchingShorts = false;
            return;
        }

        const startIndex = loadedShortsList.length;
        videoPosts.forEach((post, i) => {
            loadedShortsList.push(post);
            const index = startIndex + i;
            const reelItem = createShortsReelItem(post, index);
            if (sentinel) {
                feedContainer.insertBefore(reelItem, sentinel);
            } else {
                feedContainer.appendChild(reelItem);
            }
            if (autoplayObserver) autoplayObserver.observe(reelItem);
            if (virtualizationObserver) virtualizationObserver.observe(reelItem);
        });

        shortsCursor = videoPosts[videoPosts.length - 1].createdAt;

        if (videoPosts.length < 10) {
            hasMoreShorts = false;
            if (sentinel) sentinel.style.display = 'none';
        }
    } catch (err) {
        console.error("Error fetching more shorts:", err);
    } finally {
        isFetchingShorts = false;
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

    const initialSrcAttr = index < 2 ? `src="${escapeHtml(post.imageUrl)}"` : '';

    const canDownload = post.allowDownload === 1 || (currentUser && currentUser.uid === post.authorId);
    const saveBtnHtml = canDownload 
        ? `<button class="shorts-action-btn shorts-save-btn" title="ดาวน์โหลดวิดีโอ">
            <i class="fa-solid fa-download"></i>
           </button>`
        : '';

    item.innerHTML = `
        <div class="shorts-player-frame">
            <video data-src="${escapeHtml(post.imageUrl)}" ${initialSrcAttr} class="shorts-media-element" id="shorts-video-${index}" loop playsinline></video>
            
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
                </div>

                <div class="shorts-action-item">
                    <button class="shorts-action-btn shorts-share-btn">
                        <i class="fa-solid fa-share"></i>
                    </button>
                </div>

                ${saveBtnHtml ? `<div class="shorts-action-item">${saveBtnHtml}</div>` : ''}
            </div>

            <!-- Comments Drawer Modal -->
            <div class="shorts-comments-drawer" style="display: none;">
                <div class="shorts-drawer-header">
                    <h3>ความคิดเห็น</h3>
                    <button class="shorts-drawer-close-btn">&times;</button>
                </div>
                <div class="shorts-drawer-body">
                    <p style="color: #666; text-align: center; margin-top: 20px;">ระบบความคิดเห็นสำหรับ Shorts เร็วๆ นี้</p>
                </div>
            </div>
        </div>
    `;

    const videoEl = item.querySelector('video');
    const backBtn = item.querySelector('.shorts-back-btn');
    const likeBtn = item.querySelector('.post-card-like-btn');
    const shareBtn = item.querySelector('.shorts-share-btn');
    const commentBtn = item.querySelector('.shorts-comment-btn');
    const commentDrawer = item.querySelector('.shorts-comments-drawer');
    const drawerCloseBtn = item.querySelector('.shorts-drawer-close-btn');

    // Player frame container
    const frame = item.querySelector('.shorts-player-frame');

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

    // Dynamic Aspect-Ratio & Boundary Calculator
    if (frame && videoEl) {
        const applyDynamicLayout = () => {
            if (videoEl.videoWidth && videoEl.videoHeight) {
                const w = videoEl.videoWidth;
                const h = videoEl.videoHeight;
                const aspect = w / h;
                
                frame.style.aspectRatio = `${w} / ${h}`;
                
                if (aspect > 1.2) {
                    frame.style.height = 'auto';
                    frame.style.width = 'min(calc(100vw - 320px), 800px)';
                    frame.style.maxHeight = 'calc(100vh - 100px)';
                } else if (aspect >= 0.8 && aspect <= 1.2) {
                    frame.style.height = 'auto';
                    frame.style.width = 'min(calc(100vw - 320px), 580px)';
                    frame.style.maxHeight = 'calc(100vh - 80px)';
                } else {
                    frame.style.height = '100%';
                    frame.style.width = 'auto';
                    frame.style.maxHeight = 'calc(100vh - 40px)';
                }
            }
        };

        if (videoEl.readyState >= 1) {
            applyDynamicLayout();
        } else {
            videoEl.addEventListener('loadedmetadata', applyDynamicLayout);
        }

        frame.addEventListener('click', (e) => {
            if (e.target.closest('.shorts-action-btn') || e.target.closest('.shorts-back-btn') || e.target.closest('.shorts-subscribe-btn') || e.target.closest('.shorts-comments-drawer')) return;
            if (videoEl.paused) {
                videoEl.play();
            } else {
                videoEl.pause();
            }
        });
    }

    // Toggle Like
    if (likeBtn) {
        likeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                openAuthModal('login');
                showMikuToast("กรุณาเข้าสู่ระบบเพื่อกดไลก์!", "error");
                return;
            }

            try {
                const idToken = await currentUser.getIdToken();
                const res = await fetch(`${WORKER_URL}/posts/like`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`
                    },
                    body: JSON.stringify({ postId: post.id })
                });

                if (!res.ok) throw new Error("Like operation failed");
                const data = await res.json();

                const isNowLiked = data.liked;
                const newCount = data.likesCount;

                likeBtn.classList.toggle('liked', isNowLiked);
                const icon = likeBtn.querySelector('i');
                if (icon) {
                    icon.className = isNowLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
                }
                const countSpan = item.querySelector('.shorts-action-count');
                if (countSpan) countSpan.textContent = newCount;

            } catch (err) {
                console.error("Like error:", err);
                showMikuToast("ไม่สามารถกดไลก์ได้ในขณะนี้", "error");
            }
        });
    }

    // Share Button
    if (shareBtn) {
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const shareUrl = `${window.location.origin}/shorts.html?post=${post.id}`;
            navigator.clipboard.writeText(shareUrl).then(() => {
                showMikuToast("คัดลอกลิงก์แชร์ Shorts แล้ว!", "success");
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

function setupShortsObservers() {
    // 1. Virtualization Observer (Unmount video src outside 150% viewport margin to purge RAM decoders)
    if (virtualizationObserver) virtualizationObserver.disconnect();
    virtualizationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
                if (!video.getAttribute('src') && video.dataset.src) {
                    video.setAttribute('src', video.dataset.src);
                    video.load();
                }
            } else {
                if (video.hasAttribute('src')) {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                }
            }
        });
    }, {
        threshold: 0,
        rootMargin: '150% 0px 150% 0px'
    });

    // 2. Autoplay Observer (Trigger play/pause on 60% visibility)
    if (autoplayObserver) autoplayObserver.disconnect();
    autoplayObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
                if (!video.getAttribute('src') && video.dataset.src) {
                    video.setAttribute('src', video.dataset.src);
                    video.load();
                }

                if (activeVideoElement && activeVideoElement !== video) {
                    activeVideoElement.pause();
                }
                activeVideoElement = video;
                
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

    // 3. Infinite Scroll Observer (Triggers fetchMoreShorts when scrolling near bottom sentinel)
    if (infiniteScrollObserver) infiniteScrollObserver.disconnect();
    infiniteScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                fetchMoreShorts();
            }
        });
    }, {
        threshold: 0.1
    });

    // Attach virtualization and autoplay observers to existing reel items
    const items = document.querySelectorAll('.shorts-reel-item');
    items.forEach(item => {
        virtualizationObserver.observe(item);
        autoplayObserver.observe(item);
    });

    // Attach infinite scroll observer to sentinel
    const sentinel = document.getElementById('shorts-loading-sentinel');
    if (sentinel) {
        infiniteScrollObserver.observe(sentinel);
    }
}
