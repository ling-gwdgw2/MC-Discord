// Initialize Firebase Configuration ตั้งค่าการเชื่อมต่อสำหรับ Firebase
const firebaseConfig = {
  projectId: "garden-of-dreams-4768a",
  appId: "1:361575956089:web:fcaa4dd5fbed65f2bfdea8",
  storageBucket: "garden-of-dreams-4768a.firebasestorage.app",
  apiKey: "AIzaSyAubB6xN3Z0hPuWDO1YruJp8sqsAIDIUSQ",
  authDomain: "garden-of-dreams-4768a.firebaseapp.com",
  messagingSenderId: "361575956089",
  measurementId: "G-X6EF6G1KRG"
};

// Deployed Cloudflare Worker endpoint จุดเชื่อมต่อ API ของ Cloudflare Worker
const WORKER_URL = "https://miku-discord-r2-worker.vivo99621.workers.dev";

// Global Shared State ตัวแปรสถานะที่ใช้ร่วมกันระดับโกลบอล
let discordMembers = [];
let authTabState = 'login';

// Initialize Firebase App เริ่มต้นการทำงานของแอปพลิเคชัน Firebase
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    
    // Set up standard Auth State observer to sync header profile across all pages ติดตั้งตัวเฝ้าสังเกตสถานะล็อกอินเพื่อเชื่อมโยงส่วนหัวของทุกหน้าเว็บ
    firebase.auth().onAuthStateChanged(user => {
        updateHeaderProfile(user);
        if (user) {
            initNotificationSystem(user);
        } else {
            if (typeof notificationInterval !== 'undefined' && notificationInterval) {
                clearInterval(notificationInterval);
            }
        }
    });
}

// Trap Focus Helper for Accessibility ฟังก์ชันช่วยควบคุมโฟกัสของหน้าต่างเพื่อรองรับ Accessibility
function trapFocus(modalEl) {
    const focusableElements = modalEl.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return () => {};
    
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    
    const handleKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        
        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    };
    
    modalEl.addEventListener('keydown', handleKeyDown);
    return () => {
        modalEl.removeEventListener('keydown', handleKeyDown);
    };
}

// Members Modal Controller Logic ตัวควบคุมแสดงผลหน้าต่างรายชื่อสมาชิก Discord
function openMembersModal() {
    const modal = document.getElementById('members-modal');
    if (modal) {
        modal.classList.add('active');
        renderModalMembers();
        
        // Trap focus inside modal ควบคุมให้โฟกัสอยู่เฉพาะภายในหน้าต่างรายชื่อสมาชิก
        if (modal._focusTrapCleanup) modal._focusTrapCleanup();
        modal._focusTrapCleanup = trapFocus(modal);
        
        // Focus search input ย้ายโฟกัสอัตโนมัติไปที่ช่องค้นหาสมาชิก
        const searchInput = document.getElementById('member-search-input');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
    }
}

function closeMembersModal() {
    const modal = document.getElementById('members-modal');
    if (modal) {
        modal.classList.remove('active');
        if (modal._focusTrapCleanup) {
            modal._focusTrapCleanup();
            delete modal._focusTrapCleanup;
        }
    }
}

function renderModalMembers(filterQuery = '') {
    const modalList = document.getElementById('modal-members-list');
    if (!modalList) return;
    
    modalList.innerHTML = '';
    
    const query = filterQuery.toLowerCase().trim();
    const filtered = discordMembers.filter(member => 
        member.username.toLowerCase().includes(query)
    );
    
    if (filtered.length === 0) {
        const noResults = document.createElement('div');
        noResults.style.textAlign = 'center';
        noResults.style.color = 'var(--text-muted)';
        noResults.style.padding = '24px';
        noResults.style.fontSize = '15px';
        noResults.textContent = 'No members found.';
        modalList.appendChild(noResults);
        return;
    }
    
    filtered.forEach(member => {
        const row = document.createElement('div');
        row.className = 'modal-member-row';
        
        const avatarUrl = member.avatar_url || 'https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png';
        
        let statusText = member.status === 'dnd' ? 'Do Not Disturb' : member.status.charAt(0).toUpperCase() + member.status.slice(1);
        
        let activityText = statusText;
        if (member.game && member.game.name) {
            activityText = `Playing ${member.game.name}`;
        }
        
        row.innerHTML = `
            <div class="modal-member-avatar">
                <img src="${avatarUrl}" alt="${member.username}">
                <span class="status-dot ${member.status}"></span>
            </div>
            <div class="modal-member-info">
                <span class="modal-member-name">${member.username}</span>
                <span class="modal-member-activity">${activityText}</span>
            </div>
        `;
        
        modalList.appendChild(row);
    });
}

// Authentication Modal Controllers ตัวควบคุมการทำงานหน้าต่างการเข้าสู่ระบบ/สมัครสมาชิก
function openAuthModal(defaultTab = 'login') {
    const modal = document.getElementById('auth-modal');
    const alertEl = document.getElementById('auth-alert');
    if (alertEl) alertEl.style.display = 'none';
    
    if (modal) {
        modal.classList.add('active');
        switchAuthTab(defaultTab);
        
        // Trap focus inside modal ควบคุมโฟกัสให้อยู่ภายในกล่องเข้าสู่ระบบ
        if (modal._focusTrapCleanup) modal._focusTrapCleanup();
        modal._focusTrapCleanup = trapFocus(modal);
    }
}

// Global declaration so other scripts can access it ประกาศเป็นตัวแปรโกลบอลเพื่อให้สคริปต์หน้าอื่นเรียกใช้ได้
window.openAuthModal = openAuthModal;

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.remove('active');
        if (modal._focusTrapCleanup) {
            modal._focusTrapCleanup();
            delete modal._focusTrapCleanup;
        }
    }
}

function switchAuthTab(tab) {
    authTabState = tab;
    
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const formGroupName = document.getElementById('form-group-name');
    const submitBtn = document.getElementById('auth-submit-btn');
    const nameInput = document.getElementById('auth-name');
    const forgotRow = document.getElementById('auth-forgot-row');
    
    if (tab === 'login') {
        if (tabLogin) tabLogin.classList.add('active');
        if (tabSignup) tabSignup.classList.remove('active');
        if (formGroupName) formGroupName.style.display = 'none';
        if (nameInput) nameInput.removeAttribute('required');
        if (forgotRow) forgotRow.style.display = 'block';
        if (submitBtn) submitBtn.innerHTML = `Log In <i class="fa-solid fa-arrow-right-to-bracket" style="margin-left: 6px;"></i>`;
    } else {
        if (tabLogin) tabLogin.classList.remove('active');
        if (tabSignup) tabSignup.classList.add('active');
        if (formGroupName) formGroupName.style.display = 'flex';
        if (nameInput) nameInput.setAttribute('required', 'required');
        if (forgotRow) forgotRow.style.display = 'none';
        if (submitBtn) submitBtn.innerHTML = `Sign Up <i class="fa-solid fa-user-plus" style="margin-left: 6px;"></i>`;
    }
}

function displayAuthAlert(message, type = 'error') {
    const alertEl = document.getElementById('auth-alert');
    if (alertEl) {
        alertEl.className = `auth-alert ${type}`;
        alertEl.textContent = message;
        alertEl.style.display = 'block';
    }
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name') ? document.getElementById('auth-name').value : '';
    const alertEl = document.getElementById('auth-alert');
    const submitBtn = document.getElementById('auth-submit-btn');
    
    if (alertEl) alertEl.style.display = 'none';
    
    if (submitBtn) submitBtn.disabled = true;
    
    try {
        if (authTabState === 'signup') {
            const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            await user.updateProfile({
                displayName: name || email.split('@')[0]
            });
            
            displayAuthAlert('Registration successful! Logging in...', 'success');
            setTimeout(() => {
                closeAuthModal();
                updateHeaderProfile(firebase.auth().currentUser);
            }, 1000);
        } else {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            displayAuthAlert('Login successful!', 'success');
            setTimeout(() => {
                closeAuthModal();
            }, 1000);
        }
    } catch (error) {
        console.error('Auth error:', error);
        let errorMsg = error.message || 'An authentication error occurred.';
        if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
            errorMsg = 'Invalid email or password.';
        } else if (error.code === 'auth/email-already-in-use') {
            errorMsg = 'This email address is already registered.';
        } else if (error.code === 'auth/weak-password') {
            errorMsg = 'Password must be at least 6 characters.';
        } else if (error.code === 'auth/invalid-email') {
            errorMsg = 'Please enter a valid email address.';
        }
        displayAuthAlert(errorMsg, 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function handleForgotPassword(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value;
    
    if (!email) {
        displayAuthAlert('Please enter your email address in the field above to reset your password.', 'error');
        return;
    }
    
    try {
        await firebase.auth().sendPasswordResetEmail(email);
        displayAuthAlert('Password reset email sent! Please check your inbox.', 'success');
    } catch (error) {
        console.error('Password reset error:', error);
        displayAuthAlert(error.message || 'Error sending password reset email.', 'error');
    }
}

async function handleGoogleLogin() {
    const alertEl = document.getElementById('auth-alert');
    if (alertEl) alertEl.style.display = 'none';
    
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await firebase.auth().signInWithPopup(provider);
        closeAuthModal();
    } catch (error) {
        console.error('Google Sign In error:', error);
        displayAuthAlert(error.message || 'Google sign-in encountered an error.', 'error');
    }
}

function updateHeaderProfile(user) {
    const authControls = document.getElementById('header-auth-controls');
    if (authControls) {
        if (user) {
            authControls.style.display = 'none';
        } else {
            authControls.style.display = 'flex';
        }
    }
}

function showMikuToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `miku-toast ${type}`;
    
    let icon = 'fa-circle-info';
    let color = '#00f2fe';
    if (type === 'success') {
        icon = 'fa-circle-check';
        color = '#00ffcc';
    } else if (type === 'error') {
        icon = 'fa-circle-exclamation';
        color = '#ff3366';
    }
    
    toast.style.borderColor = color;
    toast.innerHTML = `
        <i class="fa-solid ${icon}" style="color: ${color}; font-size: 18px;"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Global declaration ประกาศเป็นฟังก์ชันโกลบอลเพื่อใช้ทั่วไป
window.showMikuToast = showMikuToast;

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Global declaration ประกาศเป็นฟังก์ชันโกลบอลเพื่อใช้ทั่วไป
window.escapeHtml = escapeHtml;

// Bind shared event listeners ผูกตัวดักจับเหตุการณ์ของปุ่มต่างๆ ทั่วไป
document.addEventListener('DOMContentLoaded', () => {
    // 1. Members modal listeners
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

    // 2. Auth modal listeners
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

    const tabLogin = document.getElementById('tab-login');
    if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
    
    const tabSignup = document.getElementById('tab-signup');
    if (tabSignup) tabSignup.addEventListener('click', () => switchAuthTab('signup'));

    const forgotLink = document.getElementById('auth-forgot-link');
    if (forgotLink) forgotLink.addEventListener('click', handleForgotPassword);

    const authForm = document.getElementById('auth-form');
    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
});

// Notifications System Controllers & Polling
let notificationInterval = null;

function initNotificationSystem(user) {
    const notifyBtn = document.getElementById('nav-notification-btn');
    const dropdown = document.getElementById('notification-dropdown');
    const markReadBtn = document.getElementById('btn-mark-notifications-read');
    
    if (!notifyBtn || !dropdown) return;
    
    // Toggle dropdown visibility
    notifyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
        dropdown.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            fetchNotifications(user);
        }
    });
    
    // Mark all as read
    if (markReadBtn) {
        markReadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const idToken = await user.getIdToken();
                const res = await fetch(`${WORKER_URL}/notifications/read`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                if (res.ok) {
                    const badge = document.getElementById('notification-unread-badge');
                    if (badge) badge.style.display = 'none';
                    fetchNotifications(user);
                }
            } catch (err) {
                console.error("Failed to mark notifications read:", err);
            }
        });
    }
    
    // Hide on click outside
    document.addEventListener('click', (e) => {
        if (dropdown.style.display === 'block' && !dropdown.contains(e.target) && e.target !== notifyBtn && !notifyBtn.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
    
    // Initial fetch
    fetchNotifications(user);
    
    // Set polling interval every 30 seconds
    if (notificationInterval) clearInterval(notificationInterval);
    notificationInterval = setInterval(() => fetchNotifications(user), 30000);
}

async function fetchNotifications(user) {
    const listContainer = document.getElementById('notification-dropdown-list');
    const badge = document.getElementById('notification-unread-badge');
    if (!listContainer) return;
    
    try {
        const idToken = await user.getIdToken();
        const res = await fetch(`${WORKER_URL}/notifications`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!res.ok) throw new Error("Failed to fetch");
        
        const data = await res.json();
        const list = data.notifications || [];
        
        // Count unread
        const unreadCount = list.filter(n => n.read === 0).length;
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
        
        listContainer.innerHTML = '';
        if (list.length === 0) {
            listContainer.innerHTML = `<div style="padding: 24px 16px; text-align: center; color: #888; font-style: italic; font-size: 13px;">ไม่มีการแจ้งเตือนใหม่ในขณะนี้</div>`;
            return;
        }
        
        list.forEach(item => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '12px';
            row.style.padding = '12px 16px';
            row.style.borderBottom = '1px solid #f5f5f5';
            row.style.cursor = 'pointer';
            row.style.background = item.read === 0 ? 'rgba(76, 184, 184, 0.05)' : 'white';
            row.style.transition = 'background 0.2s ease';
            
            row.addEventListener('mouseover', () => {
                row.style.background = '#f5f5f5';
            });
            row.addEventListener('mouseout', () => {
                row.style.background = item.read === 0 ? 'rgba(76, 184, 184, 0.05)' : 'white';
            });
            
            // Avatar image or initials
            let avatarHtml = '';
            if (item.senderAvatar) {
                avatarHtml = `<img src="${escapeHtml(item.senderAvatar)}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid var(--ui-dark);">`;
            } else {
                const initials = (item.senderName || 'A').substring(0, 2).toUpperCase();
                avatarHtml = `<div style="width: 38px; height: 38px; border-radius: 50%; background: var(--bg-page); color: var(--ui-dark); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; border: 1px solid var(--ui-dark);">${initials}</div>`;
            }
            
            // Notification message mapping
            let actionText = '';
            if (item.type === 'follow') {
                actionText = `ได้เริ่มติดตามคุณแล้ว!`;
            } else if (item.type === 'like') {
                actionText = `ถูกใจรูปภาพของคุณ!`;
            } else if (item.type === 'comment') {
                actionText = `แสดงความคิดเห็นต่อภาพของคุณ!`;
            }
            
            row.innerHTML = `
                ${avatarHtml}
                <div style="flex: 1; min-width: 0; font-size: 13px; line-height: 1.4;">
                    <strong style="color: var(--ui-dark); font-weight: 700;">${escapeHtml(item.senderName || 'Anonymous')}</strong> ${actionText}
                    <div style="font-size: 11px; color: #888; margin-top: 2px;">${formatTimeAgo(item.createdAt)}</div>
                </div>
                ${item.read === 0 ? '<div style="width: 6px; height: 6px; border-radius: 50%; background: var(--accent-pink-contrast);"></div>' : ''}
            `;
            
            // Click action to deep-link to post or follow profile page
            row.addEventListener('click', () => {
                if (item.type === 'follow') {
                    window.location.href = `profile.html?uid=${item.senderId}`;
                } else if (item.type === 'like' || item.type === 'comment') {
                    if (window.location.pathname.includes('gallery.html')) {
                        // If on gallery, open lightbox directly
                        const dropdown = document.getElementById('notification-dropdown');
                        if (dropdown) dropdown.style.display = 'none';
                        if (typeof openSharedPost === 'function') {
                            openSharedPost(item.referenceId);
                        } else {
                            window.location.href = `gallery.html?sharedPostId=${item.referenceId}`;
                        }
                    } else {
                        // Otherwise, redirect to gallery with deep link
                        window.location.href = `gallery.html?sharedPostId=${item.referenceId}`;
                    }
                }
            });
            
            listContainer.appendChild(row);
        });
    } catch (err) {
        console.error("Error fetching notifications:", err);
    }
}

// Clean helper to escape HTML characters
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Time formatting helper
function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'เมื่อครู่นี้';
    if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
    if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
    return `${days} วันที่แล้ว`;
}
