// Gallery Client-Side Script สคริปต์ควบคุมการทำงานหน้าแกลเลอรีฝั่งผู้ใช้

// Helper function to compress image client-side to WebP format ฟังก์ชันบีบอัดรูปภาพฝั่งผู้ใช้ให้เป็นฟอร์แมต WebP
function compressImage(file, maxWidth = 1600, maxHeight = 1600) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            resolve(file);
            return;
        }
        
        const img = new Image();
        img.src = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Canvas conversion to Blob failed"));
                    return;
                }
                const filename = file.name.substring(0, file.name.lastIndexOf('.')) + '.webp';
                const compressedFile = new File([blob], filename, {
                    type: 'image/webp',
                    lastModified: Date.now()
                });
                resolve(compressedFile);
            }, 'image/webp', 0.8);
        };
        
        img.onerror = (err) => {
            reject(err);
        };
    });
}
// Global FFmpeg instance holder
let ffmpegInstance = null;

// Helper function to compress video client-side using FFmpeg WASM
async function compressVideo(file, progressCallback) {
    if (!file.type.startsWith('video/')) {
        return file;
    }

    const hasFFmpeg = typeof window.FFmpegWASM !== 'undefined' || typeof window.FFmpeg !== 'undefined';
    const hasFFmpegUtil = typeof window.FFmpegUtil !== 'undefined';

    if (!hasFFmpeg || !hasFFmpegUtil) {
        console.warn("FFmpeg WASM libraries not loaded, bypassing video compression.");
        return file;
    }

    const FFmpegClass = (window.FFmpegWASM && window.FFmpegWASM.FFmpeg) || (window.FFmpeg && window.FFmpeg.FFmpeg) || window.FFmpeg;
    const fetchFileFn = (window.FFmpegUtil && window.FFmpegUtil.fetchFile) || (window.FFmpeg && window.FFmpeg.fetchFile);

    if (!FFmpegClass || typeof FFmpegClass !== 'function') {
        console.warn("FFmpeg object unavailable, uploading original video.");
        return file;
    }

    try {
        if (!ffmpegInstance) {
            ffmpegInstance = new FFmpegClass();
        }
        
        if (!ffmpegInstance.loaded) {
            if (progressCallback) progressCallback('Init FFmpeg...');
            await ffmpegInstance.load();
        }

        const inputName = `input_${Date.now()}.${file.name.split('.').pop() || 'mp4'}`;
        const outputName = `output_${Date.now()}.mp4`;

        ffmpegInstance.on('progress', ({ progress }) => {
            if (progressCallback) {
                const percent = Math.min(99, Math.round(progress * 100));
                progressCallback(`Compressing ${percent}%`);
            }
        });

        await ffmpegInstance.writeFile(inputName, await fetchFileFn(file));

        // Compress to 1080p H.264 with AAC audio
        await ffmpegInstance.exec([
            '-i', inputName,
            '-vf', "scale='min(1080,iw)':-2",
            '-vcodec', 'libx264',
            '-crf', '28',
            '-preset', 'ultrafast',
            '-acodec', 'aac',
            '-b:a', '128k',
            outputName
        ]);

        const data = await ffmpegInstance.readFile(outputName);
        const compressedBlob = new Blob([data.buffer], { type: 'video/mp4' });
        const compressedFilename = file.name.substring(0, file.name.lastIndexOf('.')) + '_compressed.mp4';
        
        // Cleanup virtual file system
        await ffmpegInstance.deleteFile(inputName);
        await ffmpegInstance.deleteFile(outputName);

        return new File([compressedBlob], compressedFilename, {
            type: 'video/mp4',
            lastModified: Date.now()
        });
    } catch (err) {
        console.error("FFmpeg compression error, falling back to original file:", err);
        return file;
    }
}

// Secure upload helper to proxy files to R2 via Cloudflare Worker ฟังก์ชันช่วยส่งรูปภาพผ่าน Worker ไปเก็บที่ R2 Storage อย่างปลอดภัย
async function uploadFileToR2(rawFile, type = 'post', progressCallback) {
    if (!WORKER_URL) {
        throw new Error("Cloudflare Worker URL is not configured. Please set WORKER_URL at the top of app.js.");
    }

    const currentUser = firebase.auth().currentUser;
    if (!currentUser) throw new Error("User must be logged in to upload files.");

    let file = rawFile;
    if (rawFile.type.startsWith('image/')) {
        try {
            const maxDim = type === 'avatar' ? 400 : 1600;
            file = await compressImage(rawFile, maxDim, maxDim);
        } catch (e) {
            console.warn("Image compression failed, uploading original:", e);
        }
    } else if (rawFile.type.startsWith('video/')) {
        try {
            file = await compressVideo(rawFile, (statusText) => {
                if (progressCallback && typeof statusText === 'string') {
                    // Pass status string back to button text handler
                    progressCallback(statusText);
                }
            });
        } catch (e) {
            console.warn("Video compression failed, uploading original:", e);
        }
    }

    const idToken = await currentUser.getIdToken();

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const endpoint = type === 'avatar' ? `${WORKER_URL}/upload-avatar` : `${WORKER_URL}/upload`;
        
        xhr.open('POST', endpoint);
        xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        
        if (type === 'post') {
            xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
        }

        if (progressCallback) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    progressCallback(percent);
                }
            };
        }

        xhr.timeout = 180000; // 3 minutes timeout for video/media uploads

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    resolve(response.imageUrl);
                } catch (e) {
                    reject(new Error("Failed to parse server response."));
                }
            } else {
                try {
                    const response = JSON.parse(xhr.responseText);
                    reject(new Error(response.error || `Upload failed with status ${xhr.status}`));
                } catch (e) {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            }
        };

        xhr.onerror = (e) => {
            console.error("XHR network upload error:", e, xhr);
            reject(new Error("Network error during file upload. Please check your network connection or CORS configuration."));
        };

        xhr.ontimeout = () => {
            console.error("XHR upload timed out after 180s");
            reject(new Error("Upload request timed out. Please try uploading a smaller file or checking your connection speed."));
        };

        // Send File/Blob directly without loading whole file into V8 ArrayBuffer heap
        xhr.send(file);
    });
}

// Discord Widget Integration & Interactive UI Logic การเชื่อมต่อข้อมูลสมาชิกจาก Discord Widget และควบคุม UI การโต้ตอบ


// Initial setup on page load ตั้งค่าเริ่มต้นระบบเมื่อโหลดหน้าเว็บ

// Initial setup on page load for Gallery Page ตั้งค่าเริ่มต้นเมื่อเปิดหน้าแกลเลอรี
window.addEventListener('DOMContentLoaded', () => {

    // Feed Switcher Tabs Bindings
    const feedTabAll = document.getElementById('feed-tab-all');
    const feedTabFollowing = document.getElementById('feed-tab-following');
    
    if (feedTabAll && feedTabFollowing) {
        feedTabAll.addEventListener('click', () => {
            if (activeGalleryTab === 'all') return;
            activeGalleryTab = 'all';
            
            // UI Toggle Styles
            feedTabAll.style.background = 'var(--primary-cyan)';
            feedTabAll.style.color = '#ffffff';
            feedTabFollowing.style.background = '#ffffff';
            feedTabFollowing.style.color = 'var(--ui-dark)';
            
            loadPosts(false);
        });
        
        feedTabFollowing.addEventListener('click', () => {
            // Check authentication status first as Following feed requires login
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                showMikuToast("กรุณาเข้าสู่ระบบเพื่อใช้งานฟีดติดตาม", "info");
                openAuthModal('login');
                return;
            }
            
            if (activeGalleryTab === 'following') return;
            activeGalleryTab = 'following';
            
            // UI Toggle Styles
            feedTabFollowing.style.background = 'var(--primary-cyan)';
            feedTabFollowing.style.color = '#ffffff';
            feedTabAll.style.background = '#ffffff';
            feedTabAll.style.color = 'var(--ui-dark)';
            
            loadPosts(false);
        });
    }

    // Search and Sort Control Bindings
    const gallerySearchInput = document.getElementById('gallery-search-input');
    if (gallerySearchInput) {
        let searchTimeout;
        gallerySearchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentSearchQuery = e.target.value.trim();
                loadPosts(false);
            }, 400); // Debounce search requests to avoid database overload
        });
    }

    const gallerySortSelect = document.getElementById('gallery-sort-select');
    if (gallerySortSelect) {
        currentSortOrder = gallerySortSelect.value || 'hot';
        gallerySortSelect.addEventListener('change', (e) => {
            currentSortOrder = e.target.value;
            loadPosts(false);
        });
    }

    // Infinite Scroll IntersectionObserver ตัวตรวจจับระยะขอบการเลื่อนหน้าจอเพื่อโหลดข้อมูลเพิ่มอัตโนมัติ
    const scrollTrigger = document.getElementById('infinite-scroll-trigger');
    if (scrollTrigger) {
        const observer = new IntersectionObserver((entries) => {
            const postSection = document.getElementById('post-section');
            if (!postSection || postSection.style.display === 'none') return;
            
            if (entries[0].isIntersecting && hasMorePosts && !isLoadingPosts) {
                loadPosts(true);
            }
        }, {
            root: null,
            rootMargin: '200px', // Pre-load posts when viewport is within 200px of the bottom
            threshold: 0.1
        });
        observer.observe(scrollTrigger);
    }

    // Modal Event Listeners ตัวดักจับการทำงานปุ่มเปิด/ปิดหน้าต่างระบบต่าง ๆ
    const membersLink = document.getElementById('nav-members-link');
    const closeBtn = document.getElementById('modal-close-btn');
    const modalOverlay = document.getElementById('members-modal');
    const searchInput = document.getElementById('member-search-input');
    
    if (membersLink) {
        membersLink.addEventListener('click', (e) => {
            e.preventDefault();
            openMembersModal();
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMembersModal);
    }
    
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeMembersModal();
            }
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderModalMembers(e.target.value);
        });
    }

    const loginHeaderBtn = document.getElementById('header-login-btn');
    const closeAuthBtn = document.getElementById('auth-close-btn');
    const authOverlay = document.getElementById('auth-modal');
    const googleAuthBtn = document.getElementById('auth-google-btn');
    const logoutBtn = document.getElementById('btn-logout');

    if (loginHeaderBtn) {
        loginHeaderBtn.addEventListener('click', () => openAuthModal('login'));
    }

    if (closeAuthBtn) {
        closeAuthBtn.addEventListener('click', closeAuthModal);
    }

    if (authOverlay) {
        authOverlay.addEventListener('click', (e) => {
            if (e.target === authOverlay) {
                closeAuthModal();
            }
        });
    }

    if (googleAuthBtn) {
        googleAuthBtn.addEventListener('click', handleGoogleLogin);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (typeof firebase !== 'undefined') {
                firebase.auth().signOut();
            }
        });
    }

    // Observe Auth State Changes ตรวจสอบความเปลี่ยนแปลงของสถานะล็อกอินเข้าสู่ระบบ
    if (typeof firebase !== 'undefined') {
        firebase.auth().onAuthStateChanged(user => {
            updateHeaderProfile(user);
            
            // Wait for auth to resolve before checking parameters
            if (typeof window.initializeGalleryPage === 'function') {
                window.initializeGalleryPage(user);
            }
            
            // Redirect to home if logged out while on profile or create section
            if (!user) {
                const createPostSec = document.getElementById('create-post-section');
                const profileSec = document.getElementById('profile-section');
                if ((createPostSec && createPostSec.style.display === 'block') ||
                    (profileSec && profileSec.style.display === 'block')) {
                    showSection('post');
                }
            } else {
                if (typeof loadProfileStats === 'function') {
                    loadProfileStats();
                }
            }
        });
    }

    // Navigation Sub-toggles inside gallery.html
    const createPostBtn = document.getElementById('nav-create-post-btn');
    if (createPostBtn) {
        createPostBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                openAuthModal('login');
                showMikuToast("Please log in to upload photos!", "error");
            } else {
                showSection('create-post');
            }
        });
    }

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

    // Dropzone Area Drag-and-Drop Listeners ตัวตรวจจับการลากไฟล์รูปภาพมาวางที่โซนอัปโหลด
    const dropzoneArea = document.getElementById('dropzone-area');
    const postFileInput = document.getElementById('post-file');
    const previewContainer = document.getElementById('dropzone-preview-container');
    const previewImg = document.getElementById('dropzone-preview-img');
    const removePreviewBtn = document.getElementById('dropzone-remove-btn');
    const dropzoneContent = document.querySelector('.dropzone-content');

    if (dropzoneArea && postFileInput) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropzoneArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropzoneArea.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzoneArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropzoneArea.classList.remove('dragover');
            }, false);
        });

        dropzoneArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                postFileInput.files = files;
                handleFileSelect(files[0]);
            }
        });
        
        postFileInput.addEventListener('change', (e) => {
            if (postFileInput.files && postFileInput.files.length > 0) {
                handleFileSelect(postFileInput.files[0]);
            }
        });
    }

    if (removePreviewBtn) {
        removePreviewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (postFileInput) postFileInput.value = '';
            if (previewContainer) previewContainer.style.display = 'none';
            if (dropzoneContent) dropzoneContent.style.display = 'flex';
        });
    }

    // Avatar upload zone listeners
    const avatarUploadZone = document.getElementById('avatar-upload-zone');
    const avatarFileInput = document.getElementById('avatar-file-input');
    
    if (avatarUploadZone && avatarFileInput) {
        avatarUploadZone.addEventListener('click', () => {
            avatarFileInput.click();
        });
        
        avatarFileInput.addEventListener('change', () => {
            if (avatarFileInput.files && avatarFileInput.files.length > 0) {
                handleAvatarUpload(avatarFileInput.files[0]);
            }
        });
        
        avatarUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            avatarUploadZone.style.background = 'rgba(0, 242, 254, 0.4)';
        });
        
        avatarUploadZone.addEventListener('dragleave', () => {
            avatarUploadZone.style.background = 'rgba(0, 0, 0, 0.6)';
        });
        
        avatarUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            avatarUploadZone.style.background = 'rgba(0, 0, 0, 0.6)';
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                handleAvatarUpload(files[0]);
            }
        });
    }


    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadNextPage);
    
    const tabLogin = document.getElementById('tab-login');
    if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
    
    const tabSignup = document.getElementById('tab-signup');
    if (tabSignup) tabSignup.addEventListener('click', () => switchAuthTab('signup'));
    
    const forgotLink = document.getElementById('auth-forgot-link');
    if (forgotLink) forgotLink.addEventListener('click', handleForgotPassword);
    
    const authForm = document.getElementById('auth-form');
    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
    
    const postForm = document.getElementById('post-form');
    if (postForm) postForm.addEventListener('submit', handlePostSubmit);



    const createPostBackBtn = document.getElementById('create-post-back-btn');
    if (createPostBackBtn) createPostBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showSection('post');
    });

    let hasInitializedPage = false;
    
    window.initializeGalleryPage = function(user) {
        if (hasInitializedPage) {
            if (user) {
                closeAuthModal();
            }
            return;
        }
        hasInitializedPage = true;

        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('action');
        const sharedPostId = urlParams.get('post');

        if (sharedPostId) {
            // Resolve and load deep-linked shared post
            (async () => {
                try {
                    const headers = {};
                    if (user) {
                        const idToken = await user.getIdToken();
                        headers['Authorization'] = `Bearer ${idToken}`;
                    }
                    const response = await fetch(`${WORKER_URL}/posts?postId=${sharedPostId}`, { headers });
                    if (response.ok) {
                        const resData = await response.json();
                        if (resData.success && resData.post) {
                            openLightbox(resData.post);
                        }
                    }
                } catch (err) {
                    console.error("Failed to load deep-linked post:", err);
                }
            })();
        }

        if (!user) {
            showSection('post');
            return;
        }

        closeAuthModal();

        if (action === 'create') {
            showSection('create-post');
        } else if (action === 'profile') {
            showSection('profile');
        } else {
            showSection('post');
        }
    };
});

function showMikuConfirm(message, onConfirm) {
    const existing = document.getElementById('miku-confirm-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'miku-confirm-modal';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-content confirm-card">
            <div class="modal-header">
                <h3>Confirm Action</h3>
                <button class="modal-close-btn" onclick="document.getElementById('miku-confirm-modal').remove()">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="modal-body confirm-body">
                <i class="fa-solid fa-circle-question confirm-icon"></i>
                <p class="confirm-message">${message}</p>
            </div>
            <div class="confirm-footer">
                <button class="btn btn-outline" onclick="document.getElementById('miku-confirm-modal').remove()">Cancel</button>
                <button class="btn btn-solid btn-confirm-action" style="background-color: var(--accent-pink-contrast); border-color: var(--accent-pink-contrast); color: #ffffff;">Confirm</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const confirmBtn = modal.querySelector('.btn-confirm-action');
    confirmBtn.addEventListener('click', () => {
        modal.remove();
        if (onConfirm) onConfirm();
    });
}
function openLightbox(postData) {
    const existing = document.getElementById('miku-lightbox');
    if (existing) {
        if (existing._focusTrapCleanup) existing._focusTrapCleanup();
        existing.remove();
    }
    
    let imageUrl = '';
    let caption = 'Hatsune Miku Illustration';
    let description = '';
    let allowDownload = 1;
    let authorId = '';
    let authorName = 'Anonymous Creator';
    let authorAvatar = '';
    let likesCount = 0;
    let postDate = 'Recently';
    let heartIcon = 'fa-regular fa-heart';
    let likedClass = '';
    
    if (typeof postData === 'string') {
        imageUrl = postData;
    } else if (postData && typeof postData === 'object') {
        imageUrl = postData.imageUrl || '';
        caption = postData.caption || 'Untitled';
        description = postData.description || '';
        allowDownload = postData.allowDownload !== undefined ? postData.allowDownload : 1;
        authorId = postData.authorId || '';
        authorName = postData.authorName || 'Anonymous Creator';
        authorAvatar = postData.authorAvatar || '';
        likesCount = postData.likes ? postData.likes.length : 0;
        
        const currentUser = firebase.auth().currentUser;
        const currentUid = currentUser ? currentUser.uid : null;
        const likesArray = postData.likes || [];
        const isLiked = currentUid && likesArray.includes(currentUid);
        if (isLiked) {
            likedClass = 'liked';
            heartIcon = 'fa-solid fa-heart';
        }
        
        if (postData.createdAt) {
            postDate = formatTimeAgo(postData.createdAt);
        }
    }
    
    let authorAvatarHtml = '';
    if (authorAvatar) {
        authorAvatarHtml = `<img src="${escapeHtml(authorAvatar)}" alt="${escapeHtml(authorName)}" class="lightbox-author-avatar">`;
    } else {
        const initials = authorName.substring(0, 2).toUpperCase();
        authorAvatarHtml = `<div class="lightbox-author-initials">${initials}</div>`;
    }
    
    const currentUser = firebase.auth().currentUser;
    const isOwner = currentUser && currentUser.uid === authorId;
    const canDownload = allowDownload === 1 || isOwner;
    const saveBtnHtml = canDownload 
        ? `<button class="lightbox-save-btn" title="ดาวน์โหลดรูปภาพ (Download Image)">
            <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 384 512" class="svgIcon">
                <path d="M169.4 470.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 370.8 224 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 306.7L54.6 265.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"></path>
            </svg>
            <span class="icon2"></span>
          </button>`
        : `<button class="lightbox-save-btn disabled" disabled title="เจ้าของรูปภาพไม่อนุญาตให้ดาวน์โหลด">
            <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 384 512" class="svgIcon">
                <path d="M169.4 470.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 370.8 224 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 306.7L54.6 265.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"></path>
            </svg>
            <span class="icon2"></span>
          </button>`;

    // Lightbox navigation index matching
    let prevIndex = -1;
    let nextIndex = -1;
    if (postData && postData.id && loadedPostsList.length > 0) {
        const currentIndex = loadedPostsList.findIndex(p => p.id === postData.id);
        if (currentIndex !== -1) {
            if (currentIndex > 0) {
                prevIndex = currentIndex - 1;
            }
            if (currentIndex < loadedPostsList.length - 1) {
                nextIndex = currentIndex + 1;
            }
        }
    }
    
    const prevBtnHtml = prevIndex !== -1 
        ? `<button class="lightbox-nav-btn prev-btn" aria-label="ภาพก่อนหน้า"><i class="fa-solid fa-chevron-left"></i></button>`
        : '';
    const nextBtnHtml = nextIndex !== -1 
        ? `<button class="lightbox-nav-btn next-btn" aria-label="ภาพถัดไป"><i class="fa-solid fa-chevron-right"></i></button>`
        : '';

    const isVideo = imageUrl.toLowerCase().endsWith('.mp4') || imageUrl.toLowerCase().endsWith('.webm');
    
    // Redirect videos clicked inside Gallery page to Shorts page
    if (isVideo && postData && typeof postData === 'object' && postData.id) {
        window.location.href = `shorts.html?post=${postData.id}`;
        return;
    }

    const lightbox = document.createElement('div');
    lightbox.id = 'miku-lightbox';
    lightbox.className = 'lightbox-overlay';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Photo Lightbox');
    lightbox.innerHTML = `
        <div class="lightbox-content-wrapper">
            <button class="lightbox-close-btn" aria-label="Close lightbox">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            ${prevBtnHtml}
            <div class="lightbox-image-container">
                <button class="lightbox-fullscreen-btn" id="lightbox-fullscreen-btn" aria-label="Fullscreen mode" title="ดูแบบเต็มหน้าจอ (Fullscreen)">
                    <i class="fa-solid fa-expand"></i>
                </button>
                <img src="${escapeHtml(imageUrl)}" alt="Expanded Photo" class="lightbox-img">
            </div>
            ${nextBtnHtml}
            <div class="lightbox-details-container">
                <div class="lightbox-actions-row">
                    <div class="lightbox-left-actions">
                        <button class="lightbox-icon-btn post-card-like-btn ${likedClass}" aria-label="Like photo">
                            <i class="${heartIcon}"></i>
                        </button>
                        <span class="post-card-likes-count" style="color: #333333; font-weight: 700; font-size: 14px; margin-right: 8px;">${likesCount}</span>
                        <button class="lightbox-icon-btn" aria-label="Share">
                            <i class="fa-solid fa-arrow-up-from-bracket"></i>
                        </button>
                        <button class="lightbox-icon-btn" aria-label="Comments">
                            <i class="fa-regular fa-comment"></i>
                        </button>
                    </div>
                    <div class="lightbox-right-actions">
                        ${saveBtnHtml}
                    </div>
                </div>
                
                <h1 class="lightbox-title">${escapeHtml(caption)}</h1>
                
                <h2 class="lightbox-section-title">คำอธิบาย</h2>
                <p class="lightbox-description">
                    ${escapeHtml(description) || '<span style="font-style: italic; color: #888888;">ไม่มีคำอธิบายสำหรับภาพนี้</span>'}
                </p>
                
                <div class="lightbox-author-row">
                    ${authorAvatarHtml}
                    <div class="lightbox-author-info">
                        <span class="lightbox-author-name">${escapeHtml(authorName)}</span>
                        <span class="lightbox-author-followers">Shared ${postDate}</span>
                    </div>
                </div>
                
                <div class="lightbox-comments-section">
                    <h2 class="lightbox-section-title">การสนทนา</h2>
                    <div class="lightbox-comments-list" id="lightbox-comments-list">
                        <div style="padding: 8px 0; font-style: italic;">ไม่มีความคิดเห็นในขณะนี้ เริ่มการสนทนาเลย!</div>
                    </div>
                </div>
                
                <div class="comment-reply-context-banner" id="comment-reply-context-banner" style="display: none; justify-content: space-between; align-items: center; background: rgba(76, 184, 184, 0.15); border-left: 4px solid var(--primary-cyan); padding: 8px 12px; margin-bottom: 8px; border-radius: 8px; font-size: 13px;">
                    <span style="color: #333;">กำลังตอบกลับคุณ <strong id="reply-to-username-label" style="color: var(--primary-cyan);"></strong></span>
                    <button type="button" id="btn-cancel-comment-reply" style="background: none; border: none; color: var(--accent-pink-contrast); cursor: pointer; padding: 2px; font-size: 14px;"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <div class="lightbox-comment-input-row">
                    <input type="text" class="lightbox-comment-input" placeholder="ใส่ความคิดเห็นเพื่อเริ่มการสนทนา">
                    <div class="lightbox-input-icons">
                        <i class="fa-regular fa-face-smile"></i>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Keyboard navigation listener ดักจับการกดปุ่มลูกศรซ้ายขวาบนคีย์บอร์ดเพื่อเลื่อนรูปภาพ
    const handleKeyDownNav = (e) => {
        if (e.key === 'ArrowLeft' && prevIndex !== -1) {
            e.preventDefault();
            openLightbox(loadedPostsList[prevIndex]);
        } else if (e.key === 'ArrowRight' && nextIndex !== -1) {
            e.preventDefault();
            openLightbox(loadedPostsList[nextIndex]);
        } else if (e.key === 'Escape') {
            closeLightbox();
        }
    };
    window.addEventListener('keydown', handleKeyDownNav);

    // Click-to-Zoom and Panning logic for high-resolution gallery art inspection
    const lightboxImg = lightbox.querySelector('.lightbox-img');
    const imgContainer = lightbox.querySelector('.lightbox-image-container');
    let isZoomed = false;
    
    const handlePan = (e) => {
        if (!isZoomed || !imgContainer || !lightboxImg) return;
        const rect = imgContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const xPercent = (x / rect.width) * 100;
        const yPercent = (y / rect.height) * 100;
        
        lightboxImg.style.transformOrigin = `${xPercent}% ${yPercent}%`;
    };
    
    if (lightboxImg && imgContainer) {
        lightboxImg.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing the lightbox overlay
            isZoomed = !isZoomed;
            
            if (isZoomed) {
                lightboxImg.classList.add('zoomed');
                imgContainer.addEventListener('mousemove', handlePan);
            } else {
                lightboxImg.classList.remove('zoomed');
                lightboxImg.style.transformOrigin = 'center center';
                imgContainer.removeEventListener('mousemove', handlePan);
            }
        });
    }

    // Fullscreen API Logic ตัวจัดการแสดงผลแบบเต็มหน้าจอ (Fullscreen)
    const fullscreenBtn = lightbox.querySelector('#lightbox-fullscreen-btn');
    
    const toggleFullscreen = (e) => {
        if (e) e.stopPropagation();
        if (!imgContainer) return;
        
        if (!document.fullscreenElement) {
            imgContainer.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
                showMikuToast("ไม่สามารถเปิดโหมดเต็มหน้าจอได้บนอุปกรณ์นี้", "error");
            });
        } else {
            document.exitFullscreen().catch(() => {});
        }
    };
    
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleFullscreen);
    }
    
    const handleFullscreenChange = () => {
        if (!fullscreenBtn) return;
        const icon = fullscreenBtn.querySelector('i');
        if (!icon) return;
        
        if (document.fullscreenElement === imgContainer) {
            icon.className = 'fa-solid fa-compress';
            fullscreenBtn.setAttribute('aria-label', 'Exit fullscreen');
            fullscreenBtn.title = 'ออกจากเต็มหน้าจอ (Exit Fullscreen)';
        } else {
            icon.className = 'fa-solid fa-expand';
            fullscreenBtn.setAttribute('aria-label', 'Fullscreen mode');
            fullscreenBtn.title = 'ดูแบบเต็มหน้าจอ (Fullscreen)';
        }
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Swipe Gesture Navigation for Mobile (Touchscreens) ระบบปัดขวาสไลด์ซ้ายเพื่อเปลี่ยนภาพสำหรับจอมือถือ
    let touchStartX = 0;
    let touchStartY = 0;
    
    const handleTouchStart = (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    };
    
    const handleTouchEnd = (e) => {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        
        // Horizontal swipe detection (> 50px offset)
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            if (diffX < -50 && nextIndex !== -1) {
                closeLightbox();
                openLightbox(loadedPostsList[nextIndex]);
            } else if (diffX > 50 && prevIndex !== -1) {
                closeLightbox();
                openLightbox(loadedPostsList[prevIndex]);
            }
        }
    };
    
    lightbox.addEventListener('touchstart', handleTouchStart, { passive: true });
    lightbox.addEventListener('touchend', handleTouchEnd, { passive: true });

    const closeLightbox = () => {
        lightbox.removeEventListener('touchstart', handleTouchStart);
        lightbox.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        if (lightboxImg && imgContainer) {
            imgContainer.removeEventListener('mousemove', handlePan);
        }
        if (lightbox._focusTrapCleanup) lightbox._focusTrapCleanup();
        window.removeEventListener('keydown', handleKeyDownNav);
        lightbox.remove();
    };
    
    const closeBtn = lightbox.querySelector('.lightbox-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target === imgContainer) {
            if (!document.fullscreenElement) {
                closeLightbox();
            }
        }
    });
    
    // Set post ID reference on lightbox overlay
    if (typeof postData === 'object' && postData.id) {
        lightbox.dataset.postId = postData.id;
    }

    // Wire up Like interaction inside lightbox เชื่อมระบบการกดถูกใจ (Like) ภายในไลท์บ็อกซ์
    const likeBtn = lightbox.querySelector('.post-card-like-btn');
    if (likeBtn && typeof postData === 'object') {
        likeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (typeof toggleLike === 'function') {
                await toggleLike(postData.id, e);
            }
        });
    }

    // Wire up Share interaction เชื่อมโยงระบบแชร์คัดลอกลิงก์ของรูปภาพนี้
    const shareBtn = lightbox.querySelector('button[aria-label="Share"]');
    if (shareBtn && typeof postData === 'object') {
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const shareUrl = `${window.location.origin}/gallery.html?post=${postData.id}`;
            navigator.clipboard.writeText(shareUrl).then(() => {
                showMikuToast("คัดลอกลิงก์แชร์ไปยังคลิปบอร์ดแล้ว!", "success");
            }).catch(err => {
                console.error("Copy error:", err);
                showMikuToast("ไม่สามารถคัดลอกลิงก์ได้", "error");
            });
        });
    }

    // Wire up Comment Button click (Scroll/Focus comment input)
    const commentIconBtn = lightbox.querySelector('button[aria-label="Comments"]');
    if (commentIconBtn) {
        commentIconBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const commentInput = lightbox.querySelector('.lightbox-comment-input');
            if (commentInput) {
                commentInput.focus();
                commentInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    // Wire up Save/Download button with CORS bypass and filename parsing เชื่อมโยงปุ่มดาวน์โหลดไฟล์ภาพพร้อมการป้องกันการติดแคช CORS
    const saveBtn = lightbox.querySelector('.lightbox-save-btn');
    if (saveBtn && typeof postData === 'object') {
        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (saveBtn.classList.contains('disabled')) {
                showMikuToast("เจ้าของรูปภาพไม่อนุญาตให้ดาวน์โหลด", "error");
                return;
            }
            showMikuToast("กำลังดาวน์โหลดภาพ...", "info");
            try {
                // CORS Cache Bypass trick: append timestamp query parameter to trigger fresh headers
                const bypassUrl = postData.imageUrl + (postData.imageUrl.includes('?') ? '&' : '?') + 'cors-bypass=' + Date.now();
                const response = await fetch(bypassUrl);
                if (!response.ok) throw new Error("Network response not ok");
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                
                // Cleanly decode filename from Firebase Storage URL path
                let fileName = 'miku-moments.png';
                try {
                    const parsedUrl = new URL(postData.imageUrl);
                    const pathSegments = parsedUrl.pathname.split('/');
                    const lastSegment = pathSegments.pop() || '';
                    fileName = decodeURIComponent(lastSegment).split('/').pop() || 'miku-moments.png';
                } catch (err) {
                    fileName = postData.imageUrl.split('/').pop()?.split('?')[0] || 'miku-moments.png';
                }
                if (!fileName.includes('.')) fileName += '.png';
                
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
                showMikuToast("บันทึกภาพสำเร็จ!", "success");
            } catch (err) {
                console.error("CORS Blob download error, falling back to window.open:", err);
                const a = document.createElement('a');
                a.href = postData.imageUrl;
                a.target = '_blank';
                a.download = 'miku-moments.png';
                document.body.appendChild(a);
                a.click();
                a.remove();
                showMikuToast("เปิดรูปภาพในแท็บใหม่แล้ว", "success");
            }
        });
    }

    // Wire up Ellipsis (More Actions) button
    const ellipsisBtn = lightbox.querySelector('button[aria-label="More actions"]');
    if (ellipsisBtn && typeof postData === 'object') {
        ellipsisBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentUser = firebase.auth().currentUser;
            const isOwner = currentUser && currentUser.uid === postData.authorId;
            
            if (isOwner) {
                closeLightbox();
                if (typeof deletePost === 'function') {
                    deletePost(postData.id, postData.imageUrl);
                }
            } else {
                showMikuToast("แจ้งรายงานภาพนี้เรียบร้อยแล้ว ขอบคุณที่ช่วยดูแลระบบ!", "success");
            }
        });
    }

    // Wire profile navigation button to open public profile
    const profileBtn = lightbox.querySelector('.lightbox-profile-btn');
    if (profileBtn && postData.authorId) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = `profile.html?uid=${postData.authorId}`;
        });
    }

    // Wire up Navigation buttons click events
    const prevBtn = lightbox.querySelector('.prev-btn');
    if (prevBtn && prevIndex !== -1) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(loadedPostsList[prevIndex]);
        });
    }
    
    const nextBtn = lightbox.querySelector('.next-btn');
    if (nextBtn && nextIndex !== -1) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(loadedPostsList[nextIndex]);
        });
    }

    // Wire up Comments System (Load and Post) ผูกการสนทนา ความคิดเห็น และระบบตอบกลับคอมเมนต์
    const commentsList = lightbox.querySelector('#lightbox-comments-list');
    const commentInput = lightbox.querySelector('.lightbox-comment-input');
    
    let activeReplyParentId = null;
    let replyToName = "";
    
    const replyBanner = lightbox.querySelector('#comment-reply-context-banner');
    const replyLabel = lightbox.querySelector('#reply-to-username-label');
    const cancelReplyBtn = lightbox.querySelector('#btn-cancel-comment-reply');
    
    if (cancelReplyBtn && replyBanner) {
        cancelReplyBtn.addEventListener('click', () => {
            activeReplyParentId = null;
            replyToName = "";
            replyBanner.style.display = 'none';
        });
    }

    const fetchAndRenderComments = async () => {
        if (!commentsList || typeof postData !== 'object') return;
        try {
            const response = await fetch(`${WORKER_URL}/posts/comments?postId=${postData.id}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.comments.length > 0) {
                    commentsList.innerHTML = '';
                    
                    const rootComments = data.comments.filter(c => !c.parentId);
                    const replyComments = data.comments.filter(c => c.parentId);
                    
                    const renderCommentElement = (c, isReply = false) => {
                        const cDate = formatTimeAgo(c.createdAt);
                        const avatarHtml = c.userAvatar 
                            ? `<img src="${escapeHtml(c.userAvatar)}" alt="${escapeHtml(c.userName)}" class="lightbox-comment-avatar">`
                            : `<div class="lightbox-comment-avatar-initials">${c.userName.substring(0, 2).toUpperCase()}</div>`;
                        
                        let deleteCommentBtnHtml = '';
                        if (currentUser && (c.userId === currentUser.uid || isOwner)) {
                            deleteCommentBtnHtml = `
                                <button class="lightbox-comment-delete-btn" data-comment-id="${c.id}" title="ลบความคิดเห็น">
                                    <i class="fa-regular fa-trash-can"></i>
                                </button>
                            `;
                        }
                        
                        let replyBtnHtml = '';
                        if (!isReply && currentUser) {
                            replyBtnHtml = `
                                <button class="comment-reply-btn" data-comment-id="${c.id}" data-user-name="${escapeHtml(c.userName)}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px; padding: 4px 0; margin-left: 10px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                                    <i class="fa-solid fa-reply"></i> ตอบกลับ
                                </button>
                            `;
                        }

                        const cEl = document.createElement('div');
                        cEl.className = 'lightbox-comment-item';
                        if (isReply) {
                            cEl.style.marginLeft = '32px';
                            cEl.style.borderLeft = '2px solid #efefef';
                            cEl.style.paddingLeft = '12px';
                        }
                        cEl.innerHTML = `
                            ${avatarHtml}
                            <div class="lightbox-comment-content" style="width: 100%;">
                                <div class="lightbox-comment-header">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span class="lightbox-comment-author">${escapeHtml(c.userName)}</span>
                                        <span class="lightbox-comment-time">${cDate}</span>
                                    </div>
                                    ${deleteCommentBtnHtml}
                                </div>
                                <p class="lightbox-comment-text">${escapeHtml(c.text)}</p>
                                ${replyBtnHtml}
                            </div>
                        `;
                        
                        const delBtn = cEl.querySelector('.lightbox-comment-delete-btn');
                        if (delBtn) {
                            delBtn.addEventListener('click', async (e) => {
                                e.stopPropagation();
                                const commentId = delBtn.dataset.commentId;
                                showMikuConfirm("คุณต้องการลบความคิดเห็นนี้ใช่หรือไม่?", async () => {
                                    showMikuToast("กำลังลบความคิดเห็น...", "info");
                                    try {
                                        const idToken = await currentUser.getIdToken();
                                        const delRes = await fetch(`${WORKER_URL}/posts/comments?id=${commentId}`, {
                                            method: 'DELETE',
                                            headers: {
                                                'Authorization': `Bearer ${idToken}`
                                            }
                                        });
                                        if (delRes.ok) {
                                            showMikuToast("ลบความคิดเห็นสำเร็จ!", "success");
                                            fetchAndRenderComments();
                                        } else {
                                            const errData = await delRes.json();
                                            throw new Error(errData.error || "Failed to delete comment");
                                        }
                                    } catch (err) {
                                        console.error("Delete comment error:", err);
                                        showMikuToast(`Error: ${err.message}`, "error");
                                    }
                                });
                            });
                        }
                        
                        const replyBtn = cEl.querySelector('.comment-reply-btn');
                        if (replyBtn) {
                            replyBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                activeReplyParentId = replyBtn.dataset.commentId;
                                replyToName = replyBtn.dataset.userName;
                                if (replyLabel && replyBanner) {
                                    replyLabel.textContent = replyToName;
                                    replyBanner.style.display = 'flex';
                                    commentInput.placeholder = `ตอบกลับคุณ ${replyToName}...`;
                                    commentInput.focus();
                                }
                            });
                        }

                        return cEl;
                    };
                    
                    rootComments.forEach(root => {
                        const rootEl = renderCommentElement(root, false);
                        commentsList.appendChild(rootEl);
                        
                        const subReplies = replyComments.filter(reply => reply.parentId === root.id);
                        subReplies.forEach(reply => {
                            const replyEl = renderCommentElement(reply, true);
                            commentsList.appendChild(replyEl);
                        });
                    });
                } else {
                    commentsList.innerHTML = '<div style="padding: 8px 0; font-style: italic; color: var(--text-muted);">ไม่มีความคิดเห็นในขณะนี้ เริ่มการสนทนาเลย!</div>';
                }
            }
        } catch (err) {
            console.error("Error loading comments:", err);
            commentsList.innerHTML = '<div style="padding: 8px 0; color: var(--accent-pink-contrast);">โหลดความคิดเห็นล้มเหลว</div>';
        }
    };

    if (typeof postData === 'object' && postData.id) {
        fetchAndRenderComments();
    }

    if (commentInput && typeof postData === 'object') {
        commentInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = commentInput.value.trim();
                if (!text) return;
                
                const currentUser = firebase.auth().currentUser;
                if (!currentUser) {
                    openAuthModal('login');
                    displayAuthAlert('Please log in to leave a comment!', 'error');
                    return;
                }
                
                commentInput.disabled = true;
                commentInput.placeholder = "กำลังส่งความคิดเห็น...";
                
                try {
                    const idToken = await currentUser.getIdToken();
                    const payload = {
                        postId: postData.id,
                        text,
                        userName: currentUser.displayName || currentUser.email.split('@')[0],
                        userAvatar: currentUser.photoURL || null,
                        parentId: activeReplyParentId
                    };
                    
                    const response = await fetch(`${WORKER_URL}/posts/comments`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${idToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    });
                    
                    if (!response.ok) {
                        const errData = await response.json();
                        throw new Error(errData.error || "Failed to post comment");
                    }
                    
                    commentInput.value = '';
                    if (replyBanner) replyBanner.style.display = 'none';
                    activeReplyParentId = null;
                    replyToName = "";
                    
                    showMikuToast("ส่งความคิดเห็นแล้ว!", "success");
                    await fetchAndRenderComments();
                } catch (err) {
                    console.error("Error posting comment:", err);
                    showMikuToast("เกิดข้อผิดพลาดในการส่งความคิดเห็น", "error");
                } finally {
                    commentInput.disabled = false;
                    commentInput.placeholder = "ใส่ความคิดเห็นเพื่อเริ่มการสนทนา";
                    commentInput.focus();
                }
            }
        });
    }

    document.body.appendChild(lightbox);
    setTimeout(() => lightbox.classList.add('active'), 10);
    
    lightbox._focusTrapCleanup = trapFocus(lightbox);
}

// Gallery & Profile pagination and query states ตัวแปรและสถานะสำหรับใช้แบ่งหน้าข้อมูลแกลเลอรี
let lastVisiblePost = null;
let activeGalleryTab = 'all';
let isLoadingPosts = false;
const POSTS_PER_PAGE = 30;

// Global feed memory cache to allow Lightbox navigation
let loadedPostsList = [];
let currentSearchQuery = '';
let currentSortOrder = 'hot';
let hasMorePosts = true;

// Dynamic Grid Virtualization Observer to free browser memory/RAM for off-screen images ตัวจัดการสลับภาพออกเพื่อประหยัด RAM บนเบราว์เซอร์
const virtualizationObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const card = entry.target;
        const img = card.querySelector('.post-card-img');
        if (!img) return;

        const realSrc = img.dataset.src || img.getAttribute('data-src');
        if (!realSrc) return;

        if (entry.isIntersecting) {
            // Re-load image when card scrolls near the viewport
            if (img.src !== realSrc) {
                img.src = realSrc;
            }
        } else {
            // Unload image (replacing it with a 1x1 transparent spacer GIF) to free browser decoded RAM
            const wrapper = card.querySelector('.post-card-img-wrapper');
            if (wrapper && wrapper.offsetHeight > 0) {
                // Ensure wrapper height is locked to prevent layout collapsing and CLS
                if (!wrapper.style.height) {
                    wrapper.style.height = `${wrapper.offsetHeight}px`;
                }
                img.removeAttribute('src'); // Unload source
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                img.classList.remove('loaded');
            }
        }
    });
}, {
    root: null,
    rootMargin: '800px', // Keep images loaded within 800px threshold of the viewport to keep scrolling fluid
    threshold: 0
});

// JS Masonry Column Helpers ฟังก์ชันช่วยคำนวณและจัดตำแหน่งรูปภาพแบบ Pinterest Masonry
let currentColumnsCount = 0;

function getColumnCount() {
    const width = window.innerWidth;
    if (width > 1200) return 4;
    if (width > 768) return 3;
    return 1;
}

function initMasonryColumns(grid, numCols) {
    grid.innerHTML = '';
    const cols = [];
    for (let i = 0; i < numCols; i++) {
        const col = document.createElement('div');
        col.className = 'masonry-col';
        grid.appendChild(col);
        cols.push(col);
    }
    return cols;
}

function getShortestColumn(cols) {
    let shortest = cols[0];
    let minHeight = shortest.offsetHeight;
    for (let i = 1; i < cols.length; i++) {
        if (cols[i].offsetHeight < minHeight) {
            shortest = cols[i];
            minHeight = cols[i].offsetHeight;
        }
    }
    return shortest;
}

function layoutMasonry(force = false) {
    const grid = document.getElementById('posts-feed-grid');
    if (!grid) return;

    const numCols = getColumnCount();
    if (!force && numCols === currentColumnsCount) return; // Column count hasn't changed, skip rebuild

    currentColumnsCount = numCols;

    // บันทึกความสูงปัจจุบันและตั้งเป็น minHeight ชั่วคราวเพื่อกันไม่ให้เบราว์เซอร์รีเซ็ต scrollY ไปที่ 0 ขณะล้างข้อมูล columns
    const originalMinHeight = grid.style.minHeight;
    const currentHeight = grid.offsetHeight;
    if (currentHeight > 0) {
        grid.style.minHeight = `${currentHeight}px`;
    }

    // Collect all loaded post cards (excluding skeletons)
    const cards = Array.from(grid.querySelectorAll('.post-card:not(.loading-skeleton-temp)'));

    // Rebuild columns
    const cols = initMasonryColumns(grid, numCols);

    // Distribute cards chronologically to the shortest column
    cards.forEach((card) => {
        const shortestCol = getShortestColumn(cols);
        shortestCol.appendChild(card);
    });

    // ปลดล็อกความสูงหลังจากจัดแถวและกระจายรูปภาพเสร็จสิ้นในเฟรมถัดไป
    requestAnimationFrame(() => {
        grid.style.minHeight = originalMinHeight;
    });
}

// Debounced resize handler for column updates
let resizeDebounceTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeDebounceTimeout);
    resizeDebounceTimeout = setTimeout(() => {
        const postSection = document.getElementById('post-section');
        if (postSection && postSection.style.display !== 'none') {
            layoutMasonry();
        }
    }, 150);
});

// Navigation SPA Router
function showSection(sectionId) {
    const navHome = document.getElementById('nav-home-link');
    const navPost = document.getElementById('nav-post-link');
    const homeSection = document.getElementById('home-section');
    const postSection = document.getElementById('post-section');
    const profileSection = document.getElementById('profile-section');
    const createPostSection = document.getElementById('create-post-section');
    
    // Hide all sections first
    if (homeSection) homeSection.style.display = 'none';
    if (postSection) postSection.style.display = 'none';
    if (profileSection) profileSection.style.display = 'none';
    if (createPostSection) createPostSection.style.display = 'none';
    
    if (navHome) navHome.classList.remove('active');
    if (navPost) navPost.classList.remove('active');
    
    if (sectionId === 'home') {
        window.location.href = 'index.html';
        return;
    } else if (sectionId === 'post') {
        if (postSection) postSection.style.display = 'block';
        if (navPost) navPost.classList.add('active');
        // Reset query pagination and load posts
        lastVisiblePost = null;
        loadPosts(false);
    } else if (sectionId === 'create-post') {
        // Auth Guard Check
        if (typeof firebase !== 'undefined') {
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                openAuthModal('login');
                displayAuthAlert('Please log in to share your photos.', 'error');
                return;
            }
        }
        if (createPostSection) createPostSection.style.display = 'block';
    } else if (sectionId === 'profile') {
        // Auth Guard Check
        if (typeof firebase !== 'undefined') {
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                openAuthModal('login');
                displayAuthAlert('Please log in to view and edit your profile.', 'error');
                return;
            }
        }
        if (profileSection) profileSection.style.display = 'block';
        // Reset profile edit card to hidden when navigating to profile section
        const profileEditCard = document.getElementById('profile-edit-card');
        if (profileEditCard) profileEditCard.style.display = 'none';
        
        if (typeof loadProfileStats === 'function') {
            loadProfileStats();
        }
        // Load user's uploaded gallery posts inside profile
        if (typeof loadProfilePosts === 'function') {
            loadProfilePosts();
        }
    }

    // Set focus on the active section for screen readers
    const activeSection = document.getElementById(`${sectionId}-section`);
    if (activeSection) {
        activeSection.setAttribute('tabindex', '-1');
        activeSection.focus();
    }
}

// S3 signing is now safely delegated to the serverless Cloudflare Worker index.js
function handleFileSelect(file) {
    if (!file) return;
    const postFileInput = document.getElementById('post-file');
    const previewContainer = document.getElementById('dropzone-preview-container');
    const previewImg = document.getElementById('dropzone-preview-img');
    const previewVideo = document.getElementById('dropzone-preview-video');
    const dropzoneContent = document.querySelector('.dropzone-content');
    
    if (file.type.startsWith('video/')) {
        if (previewImg) previewImg.style.display = 'none';
        if (previewVideo) {
            previewVideo.src = URL.createObjectURL(file);
            previewVideo.style.display = 'block';
        }
        if (previewContainer) previewContainer.style.display = 'flex';
        if (dropzoneContent) dropzoneContent.style.display = 'none';
    } else {
        if (previewVideo) {
            previewVideo.style.display = 'none';
            previewVideo.src = '';
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            if (previewImg) {
                previewImg.src = e.target.result;
                previewImg.style.display = 'block';
            }
            if (previewContainer) previewContainer.style.display = 'flex';
            if (dropzoneContent) dropzoneContent.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
}

async function handlePostSubmit(event) {
    event.preventDefault();
    
    const caption = document.getElementById('post-caption').value;
    const description = document.getElementById('post-description') ? document.getElementById('post-description').value : "";
    const visibilityVal = document.getElementById('post-visibility') ? document.getElementById('post-visibility').value : "public-download";
    
    // Parse visibility and allowDownload
    let visibility = "public";
    let allowDownload = 1;
    
    if (visibilityVal === "public-nodownload") {
        visibility = "public";
        allowDownload = 0;
    } else if (visibilityVal === "private") {
        visibility = "private";
        allowDownload = 0;
    }
    
    const postFileInput = document.getElementById('post-file');
    const file = postFileInput ? postFileInput.files[0] : null;
    const submitBtn = document.getElementById('post-submit-btn');
    const previewContainer = document.getElementById('dropzone-preview-container');
    const dropzoneContent = document.querySelector('.dropzone-content');
    
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    
    if (!file) {
        showMikuToast("Please select a file first.", "error");
        return;
    }
    
    if (!firebase.auth().currentUser) {
        showMikuToast("You must be logged in to post.", "error");
        return;
    }
    
    // Disable submit
    if (submitBtn) {
        submitBtn.disabled = true;
        const playText = submitBtn.querySelector('.play');
        if (playText) {
            playText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" style="margin-right: 6px;"></i> Processing...`;
        }
    }
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    
    try {
        const imageUrl = await uploadFileToR2(file, 'post', (progress) => {
            if (submitBtn) {
                const playText = submitBtn.querySelector('.play');
                if (playText) {
                    if (typeof progress === 'number') {
                        playText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" style="margin-right: 6px;"></i> Uploading ${progress}%...`;
                        if (progressBar) progressBar.style.width = `${progress}%`;
                    } else {
                        playText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" style="margin-right: 6px;"></i> ${progress}`;
                    }
                }
            }
        });
        
        // Save metadata to Cloudflare D1 Database via Cloudflare Worker
        const currentUser = firebase.auth().currentUser;
        const idToken = await currentUser.getIdToken();
        const response = await fetch(`${WORKER_URL}/posts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                caption: caption,
                description: description,
                visibility: visibility,
                allowDownload: allowDownload,
                imageUrl: imageUrl,
                authorId: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email.split('@')[0],
                authorAvatar: currentUser.photoURL || null
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Failed to save post metadata");
        }
        
        // Reset form and refresh
        document.getElementById('post-form').reset();
        const previewVideo = document.getElementById('dropzone-preview-video');
        if (previewVideo) {
            previewVideo.src = '';
            previewVideo.style.display = 'none';
        }
        if (previewContainer) previewContainer.style.display = 'none';
        if (dropzoneContent) dropzoneContent.style.display = 'flex';
        if (progressContainer) progressContainer.style.display = 'none';
        
        // Redirect to gallery view (which automatically triggers loadPosts)
        showSection('post');
        showMikuToast("Post created successfully!", "success");
        
    } catch (err) {
        console.error("Upload error details:", err);
        showMikuToast(`Error: ${err.message}`, "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            const playText = submitBtn.querySelector('.play');
            if (playText) {
                playText.innerHTML = 'Post Photo';
            }
        }
        if (progressContainer) progressContainer.style.display = 'none';
    }
}

async function loadPosts(append = false) {
    if (isLoadingPosts) return;
    isLoadingPosts = true;
    
    const loader = document.getElementById('posts-loader');
    const emptyState = document.getElementById('posts-empty-state');
    const grid = document.getElementById('posts-feed-grid');
    const countEl = document.getElementById('posts-count');
    const loadMoreContainer = document.getElementById('load-more-container');
    
    if (!grid) {
        isLoadingPosts = false;
        return;
    }
    
    if (!append) {
        if (emptyState) emptyState.style.display = 'none';
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        
        lastVisiblePost = null;
        loadedPostsList = [];
        
        const numCols = getColumnCount();
        currentColumnsCount = numCols;
        const cols = initMasonryColumns(grid, numCols);
        
        // Show 6 shimmer skeleton cards inside the grid layout initially to prevent CLS
        const skeletonHeights = ['height-sm', '', 'height-lg', '', 'height-sm', 'height-lg'];
        for (let i = 0; i < 6; i++) {
            const hClass = skeletonHeights[i];
            const skeletonCard = document.createElement('div');
            skeletonCard.className = 'post-card loading-skeleton-temp';
            skeletonCard.innerHTML = `
                <div class="skeleton-card" style="margin-bottom: 0; border: none; box-shadow: none; padding: 0;">
                    <div class="skeleton-img ${hClass}"></div>
                    <div class="skeleton-text short"></div>
                    <div class="skeleton-text long"></div>
                </div>
            `;
            const shortestCol = getShortestColumn(cols);
            shortestCol.appendChild(skeletonCard);
        }
    } else {
        // Append 3 shimmer skeleton cards at the bottom of the grid layout while loading next page
        let cols = Array.from(grid.querySelectorAll('.masonry-col'));
        if (cols.length === 0) {
            const numCols = getColumnCount();
            currentColumnsCount = numCols;
            cols = initMasonryColumns(grid, numCols);
        }
        const skeletonHeights = ['', 'height-sm', 'height-lg'];
        for (let i = 0; i < 3; i++) {
            const hClass = skeletonHeights[i];
            const skeletonCard = document.createElement('div');
            skeletonCard.className = 'post-card loading-skeleton-temp';
            skeletonCard.innerHTML = `
                <div class="skeleton-card" style="margin-bottom: 0; border: none; box-shadow: none; padding: 0;">
                    <div class="skeleton-img ${hClass}"></div>
                    <div class="skeleton-text short"></div>
                    <div class="skeleton-text long"></div>
                </div>
            `;
            const shortestCol = getShortestColumn(cols);
            shortestCol.appendChild(skeletonCard);
        }
    }
    
    try {
        let endpoint = activeGalleryTab === 'following' 
            ? `${WORKER_URL}/posts/following?limit=${POSTS_PER_PAGE}`
            : `${WORKER_URL}/posts?limit=${POSTS_PER_PAGE}`;
            
        if (currentSearchQuery) {
            endpoint += `&q=${encodeURIComponent(currentSearchQuery)}`;
        }
        if (currentSortOrder) {
            endpoint += `&sort=${currentSortOrder}`;
        }
        if (append && lastVisiblePost) {
            endpoint += `&cursor=${lastVisiblePost}`;
        }
        
        const headers = {};
        const currentUser = firebase.auth().currentUser;
        if (currentUser) {
            const idToken = await currentUser.getIdToken();
            headers['Authorization'] = `Bearer ${idToken}`;
        }
        
        const res = await fetch(endpoint, { headers });
        if (!res.ok) throw new Error("Failed to fetch posts");
        const resData = await res.json();
        const posts = resData.posts || [];
        
        // Clean up any dynamic skeletons before inserting loaded posts
        grid.querySelectorAll('.loading-skeleton-temp').forEach(el => el.remove());
        if (loader) loader.style.display = 'none';
        
        // Append or set loaded list
        if (append) {
            loadedPostsList = loadedPostsList.concat(posts);
        } else {
            loadedPostsList = posts;
        }
        
        // Fetch total count for display
        let totalCount = 0;
        if (activeGalleryTab === 'following') {
            totalCount = loadedPostsList.length;
        } else {
            let countEndpoint = `${WORKER_URL}/posts/count`;
            const countParams = [];
            if (currentSearchQuery) {
                countParams.push(`q=${encodeURIComponent(currentSearchQuery)}`);
            }
            if (countParams.length > 0) {
                countEndpoint += `?${countParams.join('&')}`;
            }
            
            const countRes = await fetch(countEndpoint, { headers });
            if (countRes.ok) {
                const countData = await countRes.json();
                totalCount = countData.count || 0;
            }
        }
        if (countEl) countEl.textContent = `${totalCount} post${totalCount === 1 ? '' : 's'}`;
        
        if (posts.length === 0 && !append) {
            if (emptyState) emptyState.style.display = 'flex';
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
            return;
        }
        
        if (emptyState) emptyState.style.display = 'none';
        
        posts.forEach((data) => {
            const id = data.id;
            
            let timeStr = 'Just now';
            if (data.createdAt) {
                const date = new Date(data.createdAt);
                timeStr = formatTimeAgo(date);
            }
            
            const card = document.createElement('div');
            card.className = 'post-card';
            card.dataset.id = id;
            
            const escapedAuthorName = escapeHtml(data.authorName || 'Anonymous');
            const escapedImageUrl = escapeHtml(data.imageUrl || '');
            const escapedAuthorAvatar = data.authorAvatar ? escapeHtml(data.authorAvatar) : '';
            
            let authorAvatarHtml = `<div class="post-author-initials">${escapedAuthorName.charAt(0).toUpperCase()}</div>`;
            if (escapedAuthorAvatar) {
                authorAvatarHtml = `<img src="${escapedAuthorAvatar}" alt="Avatar" class="card-avatar">`;
            }
            
            let deleteBtnHtml = '';
            if (currentUser && data.authorId === currentUser.uid) {
                deleteBtnHtml = `
                    <button class="post-card-delete-btn" title="Delete Post">
                        <i class="fa-regular fa-trash-can action-button-icon"></i>
                    </button>
                `;
            }
            
            // Like System calculations
            const likesArray = data.likes || [];
            const liked = currentUser && likesArray.includes(currentUser.uid);
            const likedClass = liked ? 'liked' : '';
            const heartIcon = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            const likedLabel = liked ? 'Unlike photo' : 'Like photo';

            const isVideo = escapedImageUrl.toLowerCase().endsWith('.mp4') || escapedImageUrl.toLowerCase().endsWith('.webm');
            let mediaHtml = '';
            if (isVideo) {
                mediaHtml = `
                    <div class="video-cover-container">
                        <video src="${escapedImageUrl}#t=0.1" preload="metadata" class="post-card-img video-cover-element" muted playsinline></video>
                        <div class="video-play-badge">
                            <i class="fa-solid fa-play"></i>
                        </div>
                    </div>
                `;
            } else {
                mediaHtml = `
                    <img src="${escapedImageUrl}" data-src="${escapedImageUrl}" alt="Uploaded Post Photo" class="post-card-img" onerror="this.src='assets/logo_02.webp'" loading="lazy">
                `;
            }
            
            card.innerHTML = `
                <div class="card-header">
                    ${authorAvatarHtml}
                    <span class="card-username">${escapedAuthorName}</span>
                </div>
                <div class="post-card-img-wrapper">
                    ${mediaHtml}
                </div>
                <p class="card-caption">${escapeHtml(data.caption)}</p>
                <div class="card-actions">
                    <div class="post-card-like-row">
                        <button class="action-button like-button post-card-like-btn ${likedClass}" aria-label="${likedLabel}">
                            <i class="${heartIcon} action-button-icon"></i>
                        </button>
                        <span class="post-card-likes-count">${likesArray.length}</span>
                    </div>
                    <span class="post-card-time">${timeStr}</span>
                    ${deleteBtnHtml}
                </div>
            `;
            
            // Media loaded smooth fade-in observer & height-locking for virtualization stability
            const mediaEl = card.querySelector('.post-card-img');
            if (mediaEl) {
                const onMediaLoaded = () => {
                    const src = mediaEl.src || mediaEl.currentSrc;
                    if (src && !src.startsWith('data:image/gif')) {
                        mediaEl.classList.add('loaded');
                        const wrapper = card.querySelector('.post-card-img-wrapper');
                        if (wrapper && wrapper.style.height) return;
                        if (wrapper) {
                            wrapper.style.height = `${wrapper.offsetHeight}px`;
                        }
                        layoutMasonry(true);
                    }
                };

                if (isVideo) {
                    mediaEl.onloadeddata = onMediaLoaded;
                    if (mediaEl.readyState >= 2) onMediaLoaded();
                } else {
                    mediaEl.onload = onMediaLoaded;
                    if (mediaEl.complete && mediaEl.src && !mediaEl.src.startsWith('data:image/gif')) {
                        onMediaLoaded();
                    }
                }
            }
            
            // Attach Event Listeners programmatically for safety against XSS
            const imgWrapper = card.querySelector('.post-card-img-wrapper');
            if (imgWrapper) {
                imgWrapper.addEventListener('click', () => openLightbox(data));
            }
            
            const likeBtn = card.querySelector('.post-card-like-btn');
            if (likeBtn) {
                likeBtn.addEventListener('click', (e) => toggleLike(id, e));
            }
            
            const deleteBtn = card.querySelector('.post-card-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deletePost(id, data.imageUrl));
            }
            
            // Append card to shortest column to maintain left-to-right chronological order
            let cols = Array.from(grid.querySelectorAll('.masonry-col'));
            if (cols.length === 0) {
                const numCols = getColumnCount();
                currentColumnsCount = numCols;
                cols = initMasonryColumns(grid, numCols);
            }
            const shortestCol = getShortestColumn(cols);
            shortestCol.appendChild(card);
            
            // Register card with the virtualization observer
            if (virtualizationObserver) {
                virtualizationObserver.observe(card);
            }
        });
        
        // Update pagination cursor and hasMorePosts state
        if (posts.length > 0) {
            lastVisiblePost = posts[posts.length - 1].createdAt;
        }
        
        hasMorePosts = posts.length >= POSTS_PER_PAGE;
        
        // Hide Load More container completely to preserve seamless Infinite Scroll aesthetics
        if (loadMoreContainer) {
            loadMoreContainer.style.display = 'none';
        }
        
        // Trigger auto load if loaded items do not fill the initial viewport height (on large displays)
        setTimeout(() => {
            if (hasMorePosts && !isLoadingPosts && document.documentElement.scrollHeight <= window.innerHeight) {
                loadPosts(true);
            }
        }, 200);
        
    } catch (error) {
        console.error("Database read error:", error);
        grid.querySelectorAll('.loading-skeleton-temp').forEach(el => el.remove());
        if (loader) loader.style.display = 'none';
        showMikuToast(`Failed to load feed: ${error.message}`, "error");
    } finally {
        isLoadingPosts = false;
    }
}

function loadNextPage() {
    loadPosts(true);
}

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return `${interval} year${interval === 1 ? '' : 's'} ago`;
    
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return `${interval} month${interval === 1 ? '' : 's'} ago`;
    
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return `${interval} day${interval === 1 ? '' : 's'} ago`;
    
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return `${interval} hour${interval === 1 ? '' : 's'} ago`;
    
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return `${interval} minute${interval === 1 ? '' : 's'} ago`;
    
    return 'Just now';
}
async function deletePost(postId, imageUrl) {
    showMikuConfirm("Are you sure you want to delete this photo post?", async () => {
        try {
            const currentUser = firebase.auth().currentUser;
            if (currentUser) {
                const idToken = await currentUser.getIdToken();
                const response = await fetch(`${WORKER_URL}/posts?id=${postId}`, {
                    method: 'DELETE',
                    headers: {
                        "Authorization": `Bearer ${idToken}`
                    }
                });
                
                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || "Failed to delete post from database");
                }
            }
            
            try {
                // Extract R2 object key from public URL
                let key = "";
                const marker = "pub-8a49bdb4e8284c3ca96c2d6a29ff8cc1.r2.dev/";
                const markerIdx = imageUrl.indexOf(marker);
                if (markerIdx !== -1) {
                    key = imageUrl.substring(markerIdx + marker.length);
                } else {
                    key = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
                }
                
                if (key && WORKER_URL) {
                    const currentUser = firebase.auth().currentUser;
                    if (currentUser) {
                        const idToken = await currentUser.getIdToken();
                        
                        const response = await fetch(`${WORKER_URL}/delete?file=${encodeURIComponent(key)}`, {
                            method: 'DELETE',
                            headers: {
                                "Authorization": `Bearer ${idToken}`
                            }
                        });
                        
                        if (!response.ok) {
                            throw new Error(`Worker returned status ${response.status}`);
                        }
                    }
                }
            } catch (r2Err) {
                console.warn("Could not delete file from Cloudflare R2:", r2Err);
            }
            
            showMikuToast("Post deleted successfully.", "success");
            loadPosts(false);
            
            // Refresh profile view if it's currently open
            const profileSection = document.getElementById('profile-section');
            if (profileSection && profileSection.style.display !== 'none') {
                if (typeof loadProfilePosts === 'function') loadProfilePosts();
                if (typeof loadProfileStats === 'function') loadProfileStats();
            }
        } catch (err) {
            console.error("Delete error:", err);
            showMikuToast(`Error deleting post: ${err.message}`, "error");
        }
    });
}

function syncLikeUI(postId, liked, newCount) {
    // 1. Sync card in the main grid feed
    const feedCard = document.querySelector(`.post-card[data-id="${postId}"]`);
    if (feedCard) {
        const gridLikeBtn = feedCard.querySelector('.post-card-like-btn');
        const gridHeart = gridLikeBtn ? gridLikeBtn.querySelector('i') : null;
        const gridCount = feedCard.querySelector('.post-card-likes-count');
        if (gridLikeBtn && gridHeart && gridCount) {
            if (liked) {
                gridLikeBtn.classList.add('liked');
                gridHeart.className = 'fa-solid fa-heart';
            } else {
                gridLikeBtn.classList.remove('liked');
                gridHeart.className = 'fa-regular fa-heart';
            }
            gridCount.textContent = newCount;
        }
    }
    
    // 2. Sync active lightbox overlay if open
    const lightbox = document.getElementById('miku-lightbox');
    if (lightbox && lightbox.dataset.postId === postId) {
        const lbLikeBtn = lightbox.querySelector('.post-card-like-btn');
        const lbHeart = lbLikeBtn ? lbLikeBtn.querySelector('i') : null;
        const lbCount = lightbox.querySelector('.post-card-likes-count');
        if (lbLikeBtn && lbHeart && lbCount) {
            if (liked) {
                lbLikeBtn.classList.add('liked');
                lbHeart.className = 'fa-solid fa-heart';
            } else {
                lbLikeBtn.classList.remove('liked');
                lbHeart.className = 'fa-regular fa-heart';
            }
            lbCount.textContent = newCount;
        }
    }
}

async function toggleLike(postId, event) {
    if (event) event.stopPropagation(); // Stop click bubbling up to Lightbox
    
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        openAuthModal('login');
        displayAuthAlert('Please log in to like photos!', 'error');
        return;
    }
    
    // Determine current state (optimistic) from DOM
    let liked = false;
    let currentCount = 0;
    
    const card = document.querySelector(`.post-card[data-id="${postId}"]`);
    const gridLikeBtn = card ? card.querySelector('.post-card-like-btn') : null;
    const gridCount = card ? card.querySelector('.post-card-likes-count') : null;
    
    const lb = document.getElementById('miku-lightbox');
    const lbLikeBtn = lb && lb.dataset.postId === postId ? lb.querySelector('.post-card-like-btn') : null;
    const lbCount = lb && lb.dataset.postId === postId ? lb.querySelector('.post-card-likes-count') : null;
    
    if (gridLikeBtn && gridCount) {
        liked = gridLikeBtn.classList.contains('liked');
        currentCount = parseInt(gridCount.textContent || "0");
    } else if (lbLikeBtn && lbCount) {
        liked = lbLikeBtn.classList.contains('liked');
        currentCount = parseInt(lbCount.textContent || "0");
    }
    
    const nextLiked = !liked;
    const nextCount = nextLiked ? currentCount + 1 : Math.max(0, currentCount - 1);
    
    // Optimistic UI updates
    syncLikeUI(postId, nextLiked, nextCount);
    
    try {
        const idToken = await currentUser.getIdToken();
        const response = await fetch(`${WORKER_URL}/posts/like`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                postId,
                senderName: currentUser.displayName || currentUser.email.split('@')[0],
                senderAvatar: currentUser.photoURL || null
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Failed to toggle like");
        }
        
        const data = await response.json();
        const serverLiked = data.liked;
        if (serverLiked !== nextLiked) {
            const finalCount = serverLiked ? currentCount + 1 : Math.max(0, currentCount - 1);
            syncLikeUI(postId, serverLiked, finalCount);
        }
    } catch (err) {
        console.error("Error toggling like:", err);
        showMikuToast("Failed to like post. Try again.", "error");
        
        // Revert UI updates on error
        syncLikeUI(postId, liked, currentCount);
    }
}

// Bind custom slider controls and auth handlers to global window object
window.toggleLike = toggleLike;
window.loadNextPage = loadNextPage;
window.openMembersModal = openMembersModal;
window.closeMembersModal = closeMembersModal;
window.switchAuthTab = switchAuthTab;
window.handleAuthSubmit = handleAuthSubmit;
window.handleForgotPassword = handleForgotPassword;
window.handlePostSubmit = handlePostSubmit;
window.handleFileSelect = handleFileSelect;
window.switchSection = showSection;
window.deletePost = deletePost;
window.showMikuToast = showMikuToast;
window.showMikuConfirm = showMikuConfirm;
window.openLightbox = openLightbox;


