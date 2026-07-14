CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    caption TEXT,
    description TEXT,
    visibility TEXT DEFAULT 'public',
    allowDownload INTEGER DEFAULT 1,
    imageUrl TEXT NOT NULL,
    authorId TEXT NOT NULL,
    authorName TEXT NOT NULL,
    authorAvatar TEXT,
    createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
    postId TEXT NOT NULL,
    userId TEXT NOT NULL,
    PRIMARY KEY (postId, userId),
    FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    postId TEXT NOT NULL,
    userId TEXT NOT NULL,
    userName TEXT NOT NULL,
    userAvatar TEXT,
    text TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_follows (
    followerId TEXT NOT NULL,
    followingId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    PRIMARY KEY (followerId, followingId)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(followerId);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(followingId);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    senderName TEXT NOT NULL,
    senderAvatar TEXT,
    type TEXT NOT NULL,
    referenceId TEXT,
    read INTEGER DEFAULT 0,
    createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId);
