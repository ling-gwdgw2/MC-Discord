// Local Slide Controls
let currentSlideIndex = 0;
let totalSlides = 2;

function slideNext() {
    const track = document.getElementById('slider-track');
    if (track) {
        totalSlides = track.children.length || 2;
    }
    currentSlideIndex = (currentSlideIndex + 1) % totalSlides;
    updateSliderPosition();
}

function slidePrev() {
    const track = document.getElementById('slider-track');
    if (track) {
        totalSlides = track.children.length || 2;
    }
    currentSlideIndex = (currentSlideIndex - 1 + totalSlides) % totalSlides;
    updateSliderPosition();
}

function updateSliderPosition() {
    const track = document.getElementById('slider-track');
    if (track) {
        track.style.transform = `translateX(-${currentSlideIndex * 100}%)`;
    }
}

// Dynamically fetch and add top 2 liked artwork cards from D1 Database
async function fetchAndPopulateSlider() {
    const track = document.getElementById('slider-track');
    if (!track) return;
    
    try {
        const response = await fetch(`${WORKER_URL}/posts?limit=2&sort=likes`);
        if (!response.ok) throw new Error("Failed to fetch top liked artwork");
        
        const data = await response.json();
        const posts = data.posts || [];
        
        posts.forEach(post => {
            const card = document.createElement('div');
            card.className = 'artwork-card';
            card.innerHTML = `
                <div class="card-img-wrapper">
                    <img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.caption)}" class="slider-artwork-img" onerror="this.src='assets/logo_02.webp'" loading="lazy">
                </div>
                <div class="artwork-author">by @${escapeHtml(post.authorName)}</div>
            `;
            
            // Allow clicking to redirect and open lightbox split-screen modal on gallery page
            const img = card.querySelector('img');
            if (img) {
                img.addEventListener('click', () => {
                    window.location.href = `gallery.html?post=${post.id}`;
                });
                img.style.cursor = 'zoom-in';
            }
            
            track.appendChild(card);
        });
        
        totalSlides = track.children.length;
        console.log(`Artwork slider updated. Total slides: ${totalSlides}`);
    } catch (err) {
        console.warn("Failed to populate artwork slider:", err);
    }
}

// Close Chibi Sticker Interactivity
function closeSticker(stickerId) {
    const sticker = document.getElementById(stickerId);
    if (sticker) {
        // Fade out transition
        sticker.style.opacity = '0';
        sticker.style.transform = 'scale(0.8) rotate(-10deg)';
        setTimeout(() => {
            sticker.style.display = 'none';
        }, 300);
    }
}

// Fetch Live Discord Widget Data
async function fetchDiscordData() {
    const apiEndpoint = 'https://discord.com/api/guilds/1372224704936546424/widget.json';
    
    try {
        const response = await fetch(apiEndpoint);
        if (!response.ok) throw new Error('Guild widget request failed');
        const data = await response.json();
        updateDiscordUI(data);
    } catch (error) {
        console.warn('Failed to retrieve Discord live widget data:', error);
        fallbackDiscordUI();
    }
}

function updateDiscordUI(data) {
    const serverNameEl = document.getElementById('discord-server-name');
    if (serverNameEl && data.name) {
        serverNameEl.textContent = data.name;
    }

    const inviteLink = document.querySelectorAll('.discord-invite-link');
    if (inviteLink && data.instant_invite) {
        inviteLink.forEach(link => {
            link.href = data.instant_invite;
        });
    }

    // Set Live Channels List
    const channelsList = document.getElementById('discord-channels-container');
    if (channelsList && data.channels) {
        channelsList.innerHTML = '';
        const displayChannels = data.channels.slice(0, 5);
        displayChannels.forEach((ch, idx) => {
            const styleNum = (idx % 5) + 1;
            const pill = document.createElement('div');
            pill.className = `channel-pill style-${styleNum}`;
            pill.innerHTML = `
                <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                <span class="channel-name">${escapeHtml(ch.name)}</span>
            `;
            channelsList.appendChild(pill);
        });
    }

    // Set Live Active Members list & Presence count
    const onlineCountEl = document.getElementById('discord-online-count');
    const membersCount = data.presence_count || 0;
    if (onlineCountEl) {
        onlineCountEl.textContent = `${membersCount} Members Online`;
    }

    const membersContainer = document.getElementById('members-list-container');
    if (membersContainer && data.members) {
        membersContainer.innerHTML = '';
        
        discordMembers = data.members || [];
        
        // Show up to 14 random online/idle/dnd members to fit responsive grid
        const onlineUsers = discordMembers.filter(m => m.status === 'online' || m.status === 'idle' || m.status === 'dnd');
        const displayUsers = onlineUsers.slice(0, 14);
        
        displayUsers.forEach(member => {
            const avatarUrl = member.avatar_url || 'https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png';
            
            const badge = document.createElement('div');
            badge.className = 'member-badge';
            badge.innerHTML = `
                <div class="avatar-presence-wrapper">
                    <img src="${avatarUrl}" alt="${member.username}" class="presence-avatar">
                    <span class="presence-dot ${member.status}"></span>
                </div>
                <span class="presence-name">${member.username}</span>
            `;
            membersContainer.appendChild(badge);
        });
    }
}

function fallbackDiscordUI() {
    const serverNameEl = document.getElementById('discord-server-name');
    if (serverNameEl) serverNameEl.textContent = "MC Guild Server";

    const channelsList = document.getElementById('discord-channels-container');
    if (channelsList) {
        channelsList.innerHTML = `
            <div class="channel-pill style-1">
                <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                <span class="channel-name">Game</span>
            </div>
            <div class="channel-pill style-2">
                <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                <span class="channel-name">LIVE Patch Update</span>
            </div>
            <div class="channel-pill style-3">
                <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                <span class="channel-name">Minecraft server</span>
            </div>
            <div class="channel-pill style-4">
                <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                <span class="channel-name"># General Chat</span>
            </div>
            <div class="channel-pill style-5">
                <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                <span class="channel-name"># Community Feed</span>
            </div>
        `;
    }

    const onlineCountEl = document.getElementById('discord-online-count');
    if (onlineCountEl) {
        onlineCountEl.textContent = "5 Members Online";
    }

    // Populate fallbacks
    const fallbacks = [
        { username: "Miku_Fan_01", status: "online" },
        { username: "ChibiKeyboardist", status: "idle" },
        { username: "Rin_Len_Power", status: "online" },
        { username: "LukaVocaloid", status: "dnd" },
        { username: "KaitoIceCream", status: "online" }
    ];
    
    discordMembers = fallbacks;

    const membersContainer = document.getElementById('members-list-container');
    if (membersContainer) {
        membersContainer.innerHTML = '';
        fallbacks.forEach(member => {
            const badge = document.createElement('div');
            badge.className = 'member-badge';
            badge.innerHTML = `
                <div class="avatar-presence-wrapper">
                    <img src="https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png" alt="${member.username}" class="presence-avatar">
                    <span class="presence-dot ${member.status}"></span>
                </div>
                <span class="presence-name">${member.username}</span>
            `;
            membersContainer.appendChild(badge);
        });
    }
}

// Initial setup on page load for Home Page
window.addEventListener('DOMContentLoaded', () => {

    // Initial fetch
    fetchDiscordData();
    fetchAndPopulateSlider();
    
    // Poll Discord data every 30 seconds for live updates
    let discordIntervalId = null;

    function startDiscordPolling() {
        if (!discordIntervalId) {
            discordIntervalId = setInterval(fetchDiscordData, 30000);
        }
    }

    function stopDiscordPolling() {
        if (discordIntervalId) {
            clearInterval(discordIntervalId);
            discordIntervalId = null;
        }
    }

    startDiscordPolling();

    // Pause polling when tab is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopDiscordPolling();
        } else {
            fetchDiscordData();
            startDiscordPolling();
        }
    });

    // Redirect profile/create actions on Home page to the separate Gallery page
    const navProfileBtn = document.getElementById('nav-profile-btn');
    if (navProfileBtn) {
        navProfileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = 'gallery.html?action=profile';
        });
    }

    const navCreatePostBtn = document.getElementById('nav-create-post-btn');
    if (navCreatePostBtn) {
        navCreatePostBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = 'gallery.html?action=create';
        });
    }

    // Slider arrows
    const prevArrow = document.querySelector('.prev-arrow');
    if (prevArrow) prevArrow.addEventListener('click', slidePrev);
    
    const nextArrow = document.querySelector('.next-arrow');
    if (nextArrow) nextArrow.addEventListener('click', slideNext);
    
    const waveStickerBtn = document.querySelector('#sticker-wave .close-btn');
    if (waveStickerBtn) waveStickerBtn.addEventListener('click', () => closeSticker('sticker-wave'));
    
    const winkStickerBtn = document.querySelector('#sticker-wink .close-btn');
    if (winkStickerBtn) winkStickerBtn.addEventListener('click', () => closeSticker('sticker-wink'));
});
