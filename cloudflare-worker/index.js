const PROJECT_ID = "garden-of-dreams-4768a";
const PUBLIC_R2_URL = "https://pub-8a49bdb4e8284c3ca96c2d6a29ff8cc1.r2.dev";

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://garden-of-dreams-4768a.web.app",
  "https://garden-of-dreams-4768a.firebaseapp.com"
];

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Filename, X-Migration-Secret",
    "Access-Control-Max-Age": "86400"
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  } else {
    // Fallback for safety
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS[2]; 
  }

  return headers;
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}

async function verifyFirebaseToken(token) {
  if (!token) throw new Error("No token provided");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token structure");

  const [headerB64, payloadB64, signatureB64] = parts;
  
  const header = JSON.parse(decodeText(base64UrlDecode(headerB64)));
  const payload = JSON.parse(decodeText(base64UrlDecode(payloadB64)));
  
  if (header.alg !== "RS256") throw new Error("Unsupported algorithm");
  
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error("Token expired");
  if (payload.aud !== PROJECT_ID) throw new Error("Invalid audience");
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error("Invalid issuer");
  
  // Fetch Google public keys
  const keysResponse = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", {
    cf: { cacheEverything: true, cacheTtl: 3600 }
  });
  if (!keysResponse.ok) throw new Error("Failed to fetch Google public keys");
  const { keys } = await keysResponse.json();
  
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Corresponding public key not found");
  
  // Import JWK key
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  
  // Verify signature
  const signatureBytes = base64UrlDecode(signatureB64);
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  
  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes,
    dataBytes
  );
  
  if (!isValid) throw new Error("Invalid signature");
  
  return payload;
}

// Helper to invalidate all post feed and count cache keys in KV
async function clearPostsCache(env) {
  if (!env.CACHE) return;
  try {
    let listComplete = false;
    let cursor = undefined;
    while (!listComplete) {
      const list = await env.CACHE.list({ prefix: "posts:", cursor });
      for (const key of list.keys) {
        await env.CACHE.delete(key.name);
      }
      listComplete = list.list_complete;
      cursor = list.cursor;
    }
  } catch (err) {
    console.warn("Failed to clear KV cache:", err);
  }
}

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request);

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    const isPublicGet = request.method === "GET" && (url.pathname === "/posts" || url.pathname === "/posts/count" || url.pathname === "/posts/comments");
    
    let uid = null;
    let payload = null;
    
    if (!isPublicGet) {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Missing or invalid authorization header" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const token = authHeader.split(" ")[1];
      try {
        payload = await verifyFirebaseToken(token);
        uid = payload.sub;
      } catch (err) {
        return new Response(JSON.stringify({ error: `Authentication failed: ${err.message}` }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    } else {
      // Optional authentication check for public GET to resolve user privacy permissions
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          payload = await verifyFirebaseToken(token);
          uid = payload.sub;
        } catch (err) {
          // Ignore error for public endpoints, just proceed as unauthenticated
          console.warn("Optional auth failed in public endpoint:", err.message);
        }
      }
    }

    // Route endpoints
    try {
      if (request.method === "GET" && url.pathname === "/posts") {
        const postId = url.searchParams.get("postId");
        
        // Single post detail fetch for Deep Linking
        if (postId) {
          let singleQuery = `
            SELECT p.*, 
                   (SELECT json_group_array(userId) FROM post_likes WHERE postId = p.id AND userId IS NOT NULL) as likes,
                   (SELECT COUNT(*) FROM post_likes WHERE postId = p.id) as likes_count
            FROM posts p
            WHERE p.id = ? AND (p.visibility = 'public' OR p.authorId = ?)
          `;
          const { results } = await env.DB.prepare(singleQuery).bind(postId, uid || "none").all();
          if (results.length === 0) {
            return new Response(JSON.stringify({ error: "Post not found or access denied" }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          
          const row = results[0];
          const post = {
            id: row.id,
            caption: row.caption,
            description: row.description || "",
            visibility: row.visibility || "public",
            allowDownload: row.allowDownload !== undefined ? row.allowDownload : 1,
            imageUrl: row.imageUrl,
            authorId: row.authorId,
            authorName: row.authorName,
            authorAvatar: row.authorAvatar,
            createdAt: row.createdAt,
            likes: JSON.parse(row.likes || "[]").filter(x => x !== null)
          };
          
          return new Response(JSON.stringify({ success: true, post }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const cursor = url.searchParams.get("cursor");
        const limit = parseInt(url.searchParams.get("limit") || "9");
        const authorId = url.searchParams.get("authorId");
        const sort = url.searchParams.get("sort");
        const q = url.searchParams.get("q");
        const sortMode = sort || "hot";
        
        // Scope cache key by user UID or guest to prevent private posts leaking via cache poisoning
        const cacheKey = `posts:feed:${authorId || "all"}:${cursor || "none"}:${limit}:${sortMode}:${q || "none"}:${uid || "guest"}`;
        if (env.CACHE) {
          try {
            const cachedData = await env.CACHE.get(cacheKey);
            if (cachedData) {
              return new Response(cachedData, {
                status: 200,
                headers: { "Content-Type": "application/json", "X-Cache": "HIT", ...corsHeaders }
              });
            }
          } catch (err) {
            console.warn("KV cache read error:", err);
          }
        }
        
        let query = `
          SELECT p.*, 
                 (SELECT json_group_array(userId) FROM post_likes WHERE postId = p.id AND userId IS NOT NULL) as likes,
                 (SELECT COUNT(*) FROM post_likes WHERE postId = p.id) as likes_count,
                 (SELECT COUNT(*) FROM comments WHERE postId = p.id) as comments_count
          FROM posts p
        `;
        const params = [];
        
        // Build WHERE conditions to filter private posts securely
        const conditions = [];
        
        // 1. Author Filter
        if (authorId) {
          conditions.push(`p.authorId = ?`);
          params.push(authorId);
        }
        
        // 2. Visibility Filter: only show public posts, OR private posts if they belong to the current authenticated caller (uid)
        conditions.push(`(p.visibility = 'public' OR p.authorId = ?)`);
        params.push(uid || "none");
        
        // 3. Search Query Filter
        if (q) {
          conditions.push(`(p.caption LIKE ? OR p.description LIKE ?)`);
          params.push(`%${q}%`);
          params.push(`%${q}%`);
        }
        
        // 4. Cursor Filter
        if (cursor) {
          conditions.push(`p.createdAt < ?`);
          params.push(parseInt(cursor));
        }
        
        if (conditions.length > 0) {
          query += ` WHERE ` + conditions.join(` AND `);
        }
        
        if (sortMode === "likes") {
          query += ` ORDER BY likes_count DESC, p.createdAt DESC LIMIT ? `;
        } else if (sortMode === "newest" || sortMode === "date") {
          query += ` ORDER BY p.createdAt DESC LIMIT ? `;
        } else {
          // Rule-Based Hot Score: LOG10(MAX(1, Likes*3 + Comments*5)) + (createdAt / 45,000,000.0)
          query += ` ORDER BY (
            LOG10(MAX(1, (SELECT COUNT(*) FROM post_likes WHERE postId = p.id) * 3 + (SELECT COUNT(*) FROM comments WHERE postId = p.id) * 5)) + 
            (p.createdAt / 45000000.0)
          ) DESC, p.createdAt DESC LIMIT ? `;
        }
        params.push(limit);
        
        const { results } = await env.DB.prepare(query).bind(...params).all();
        
        const posts = results.map(row => ({
          id: row.id,
          caption: row.caption,
          description: row.description || "",
          visibility: row.visibility || "public",
          allowDownload: row.allowDownload !== undefined ? row.allowDownload : 1,
          imageUrl: row.imageUrl,
          authorId: row.authorId,
          authorName: row.authorName,
          authorAvatar: row.authorAvatar,
          createdAt: row.createdAt,
          likesCount: row.likes_count || 0,
          commentsCount: row.comments_count || 0,
          likes: JSON.parse(row.likes || "[]").filter(x => x !== null)
        }));
        
        const responseData = JSON.stringify({ success: true, posts });
        if (env.CACHE) {
          try {
            await env.CACHE.put(cacheKey, responseData, { expirationTtl: 300 });
          } catch (err) {
            console.warn("KV cache write error:", err);
          }
        }
        
        return new Response(responseData, {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "MISS", ...corsHeaders }
        });

      } else if (request.method === "GET" && url.pathname === "/posts/comments") {
        const postId = url.searchParams.get("postId");
        if (!postId) {
          return new Response(JSON.stringify({ error: "Missing postId parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const { results } = await env.DB.prepare(`
          SELECT * FROM comments 
          WHERE postId = ? 
          ORDER BY createdAt ASC
        `).bind(postId).all();

        return new Response(JSON.stringify({ success: true, comments: results }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "GET" && url.pathname === "/posts/count") {
        const authorId = url.searchParams.get("authorId");
        const q = url.searchParams.get("q");
        const cacheKey = `posts:count:${authorId || "all"}:${q || "none"}:${uid || "guest"}`;
        
        if (env.CACHE) {
          try {
            const cachedCount = await env.CACHE.get(cacheKey);
            if (cachedCount) {
              return new Response(JSON.stringify({ success: true, count: parseInt(cachedCount) }), {
                status: 200,
                headers: { "Content-Type": "application/json", "X-Cache": "HIT", ...corsHeaders }
              });
            }
          } catch (err) {
            console.warn("KV count read error:", err);
          }
        }
        
        let query = "SELECT COUNT(*) as count FROM posts";
        const params = [];
        const conditions = [];
        
        if (authorId) {
          conditions.push("authorId = ?");
          params.push(authorId);
        }
        
        conditions.push("(visibility = 'public' OR authorId = ?)");
        params.push(uid || "none");
        
        if (q) {
          conditions.push("(caption LIKE ? OR description LIKE ?)");
          params.push(`%${q}%`);
          params.push(`%${q}%`);
        }
        
        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }
        
        const { results } = await env.DB.prepare(query).bind(...params).all();
        const count = results[0].count;
        
        if (env.CACHE) {
          try {
            await env.CACHE.put(cacheKey, count.toString(), { expirationTtl: 300 });
          } catch (err) {
            console.warn("KV count write error:", err);
          }
        }
        
        return new Response(JSON.stringify({ success: true, count }), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "MISS", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/posts") {
        const body = await request.json();
        const { caption, description, visibility, allowDownload, imageUrl, authorId, authorName, authorAvatar, id, createdAt, likes } = body;
        
        if (!imageUrl) {
          return new Response(JSON.stringify({ error: "Missing imageUrl" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        if (authorId !== uid) {
          return new Response(JSON.stringify({ error: "Forbidden: authorId mismatch" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const postId = id || crypto.randomUUID();
        const postCreatedAt = createdAt || Date.now();
        
        const statements = [
          env.DB.prepare(`
            INSERT OR REPLACE INTO posts (id, caption, description, visibility, allowDownload, imageUrl, authorId, authorName, authorAvatar, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            postId, 
            caption || "", 
            description || null,
            visibility || "public",
            allowDownload !== undefined ? allowDownload : 1,
            imageUrl, 
            authorId, 
            authorName, 
            authorAvatar || null, 
            postCreatedAt
          )
        ];
        
        if (Array.isArray(likes)) {
          statements.push(
            env.DB.prepare(`DELETE FROM post_likes WHERE postId = ?`).bind(postId)
          );
          likes.forEach(userId => {
            statements.push(
              env.DB.prepare(`INSERT OR IGNORE INTO post_likes (postId, userId) VALUES (?, ?)`).bind(postId, userId)
            );
          });
        }
        
        await env.DB.batch(statements);
        
        await clearPostsCache(env);
        
        return new Response(JSON.stringify({ success: true, post: { id: postId, createdAt: postCreatedAt } }), {
          status: 201,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/posts/like") {
        const body = await request.json();
        const { postId, senderName, senderAvatar } = body;
        
        if (!postId) {
          return new Response(JSON.stringify({ error: "Missing postId" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const { results } = await env.DB.prepare("SELECT 1 FROM post_likes WHERE postId = ? AND userId = ?")
          .bind(postId, uid)
          .all();
          
        let liked = false;
        if (results.length > 0) {
          await env.DB.prepare("DELETE FROM post_likes WHERE postId = ? AND userId = ?")
            .bind(postId, uid)
            .run();
          liked = false;
        } else {
          await env.DB.prepare("INSERT INTO post_likes (postId, userId) VALUES (?, ?)")
            .bind(postId, uid)
            .run();
          liked = true;
          
          // Generate notification if user liked someone else's post
          const postAuthorRes = await env.DB.prepare("SELECT authorId FROM posts WHERE id = ?").bind(postId).all();
          if (postAuthorRes.results.length > 0) {
            const authorId = postAuthorRes.results[0].authorId;
            if (authorId !== uid) {
              const notificationId = crypto.randomUUID();
              await env.DB.prepare(`
                INSERT INTO notifications (id, userId, senderId, senderName, senderAvatar, type, referenceId, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                notificationId,
                authorId,
                uid,
                senderName || "Anonymous Creator",
                senderAvatar || null,
                "like",
                postId,
                Date.now()
              ).run();
            }
          }
        }
        
        await clearPostsCache(env);
        
        return new Response(JSON.stringify({ success: true, liked }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/posts/comments") {
        const body = await request.json();
        const { postId, text, userName, userAvatar } = body;

        if (!postId || !text) {
          return new Response(JSON.stringify({ error: "Missing postId or text" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const commentId = crypto.randomUUID();
        const commentCreatedAt = Date.now();

        await env.DB.prepare(`
          INSERT INTO comments (id, postId, userId, userName, userAvatar, text, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          commentId,
          postId,
          uid,
          userName || "Anonymous",
          userAvatar || null,
          text,
          commentCreatedAt
        ).run();

        // Generate notification if user commented on someone else's post
        const postAuthorRes = await env.DB.prepare("SELECT authorId FROM posts WHERE id = ?").bind(postId).all();
        if (postAuthorRes.results.length > 0) {
          const authorId = postAuthorRes.results[0].authorId;
          if (authorId !== uid) {
            const notificationId = crypto.randomUUID();
            await env.DB.prepare(`
              INSERT INTO notifications (id, userId, senderId, senderName, senderAvatar, type, referenceId, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              notificationId,
              authorId,
              uid,
              userName || "Anonymous Creator",
              userAvatar || null,
              "comment",
              postId,
              Date.now()
            ).run();
          }
        }

        await clearPostsCache(env);

        return new Response(JSON.stringify({
          success: true,
          comment: {
            id: commentId,
            postId,
            userId: uid,
            userName: userName || "Anonymous",
            userAvatar: userAvatar || null,
            text,
            createdAt: commentCreatedAt
          }
        }), {
          status: 201,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/upload") {
        const contentType = request.headers.get("Content-Type") || "application/octet-stream";
        const rawFilename = request.headers.get("X-Filename") || "file";
        let clientFilename = rawFilename;
        try {
          clientFilename = decodeURIComponent(rawFilename);
        } catch (e) {
          clientFilename = rawFilename;
        }
        const cleanFilename = clientFilename.replace(/[^a-zA-Z0-9.-]/g, "_");
        const key = `posts/${uid}/${Date.now()}_${cleanFilename}`;
        
        const fileData = await request.arrayBuffer();

        await env.R2_BUCKET.put(key, fileData, {
          httpMetadata: { 
            contentType,
            cacheControl: "public, max-age=31536000, immutable"
          }
        });

        return new Response(JSON.stringify({
          success: true,
          imageUrl: `${PUBLIC_R2_URL}/${key}`
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/upload-avatar") {
        const contentType = request.headers.get("Content-Type") || "image/png";
        const key = `avatars/${uid}/${Date.now()}_avatar.png`;
        
        const fileData = await request.arrayBuffer();
        if (fileData.byteLength > 2 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: "File size exceeds 2MB limit" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        await env.R2_BUCKET.put(key, fileData, {
          httpMetadata: { 
            contentType,
            cacheControl: "public, max-age=31536000, immutable"
          }
        });

        return new Response(JSON.stringify({
          success: true,
          imageUrl: `${PUBLIC_R2_URL}/${key}`
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "DELETE" && url.pathname === "/posts") {
        const postId = url.searchParams.get("id");
        if (!postId) {
          return new Response(JSON.stringify({ error: "Missing id parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const { results } = await env.DB.prepare("SELECT authorId FROM posts WHERE id = ?").bind(postId).all();
        if (results.length === 0) {
          return new Response(JSON.stringify({ error: "Post not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        if (results[0].authorId !== uid) {
          return new Response(JSON.stringify({ error: "Forbidden: You do not own this post" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        await env.DB.prepare("DELETE FROM post_likes WHERE postId = ?").bind(postId).run();
        await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(postId).run();
        
        await clearPostsCache(env);
        
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "DELETE" && url.pathname === "/posts/comments") {
        const commentId = url.searchParams.get("id");
        if (!commentId) {
          return new Response(JSON.stringify({ error: "Missing id parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        // Fetch comment along with post author to verify deletion rights
        const { results } = await env.DB.prepare(`
          SELECT c.userId as commentAuthorId, p.authorId as postAuthorId 
          FROM comments c 
          JOIN posts p ON c.postId = p.id 
          WHERE c.id = ?
        `).bind(commentId).all();
        
        if (results.length === 0) {
          return new Response(JSON.stringify({ error: "Comment not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const { commentAuthorId, postAuthorId } = results[0];
        
        // Deletion is allowed if current user is either the comment creator OR the post owner
        if (commentAuthorId !== uid && postAuthorId !== uid) {
          return new Response(JSON.stringify({ error: "Forbidden: You are not authorized to delete this comment" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId).run();
        
        await clearPostsCache(env);
        
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "GET" && url.pathname === "/users/follow-status") {
        const targetUid = url.searchParams.get("targetUid");
        if (!targetUid) {
          return new Response(JSON.stringify({ error: "Missing targetUid" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const { results } = await env.DB.prepare("SELECT 1 FROM user_follows WHERE followerId = ? AND followingId = ?")
          .bind(uid, targetUid)
          .all();
          
        return new Response(JSON.stringify({ success: true, isFollowing: results.length > 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "GET" && url.pathname === "/users/follow-stats") {
        const targetUid = url.searchParams.get("targetUid");
        if (!targetUid) {
          return new Response(JSON.stringify({ error: "Missing targetUid" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const followersRes = await env.DB.prepare("SELECT COUNT(*) as count FROM user_follows WHERE followingId = ?")
          .bind(targetUid)
          .all();
        const followingRes = await env.DB.prepare("SELECT COUNT(*) as count FROM user_follows WHERE followerId = ?")
          .bind(targetUid)
          .all();
          
        return new Response(JSON.stringify({ 
          success: true, 
          followers: followersRes.results[0].count, 
          following: followingRes.results[0].count 
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/users/follow") {
        const body = await request.json();
        const { targetUid, senderName, senderAvatar } = body;
        
        if (!targetUid) {
          return new Response(JSON.stringify({ error: "Missing targetUid" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        if (targetUid === uid) {
          return new Response(JSON.stringify({ error: "You cannot follow yourself" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        
        const { results } = await env.DB.prepare("SELECT 1 FROM user_follows WHERE followerId = ? AND followingId = ?")
          .bind(uid, targetUid)
          .all();
          
        let isFollowing = false;
        if (results.length > 0) {
          await env.DB.prepare("DELETE FROM user_follows WHERE followerId = ? AND followingId = ?")
            .bind(uid, targetUid)
            .run();
          isFollowing = false;
        } else {
          await env.DB.prepare("INSERT INTO user_follows (followerId, followingId, createdAt) VALUES (?, ?, ?)")
            .bind(uid, targetUid, Date.now())
            .run();
          isFollowing = true;
          
          // Generate notification
          const notificationId = crypto.randomUUID();
          await env.DB.prepare(`
            INSERT INTO notifications (id, userId, senderId, senderName, senderAvatar, type, referenceId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            notificationId,
            targetUid,
            uid,
            senderName || "Anonymous Creator",
            senderAvatar || null,
            "follow",
            null,
            Date.now()
          ).run();
        }
        
        return new Response(JSON.stringify({ success: true, isFollowing }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "GET" && url.pathname === "/posts/following") {
        const cursor = url.searchParams.get("cursor");
        const limit = parseInt(url.searchParams.get("limit") || "9");
        
        let query = `
          SELECT p.*, 
                 (SELECT json_group_array(userId) FROM post_likes WHERE postId = p.id AND userId IS NOT NULL) as likes,
                 (SELECT COUNT(*) FROM post_likes WHERE postId = p.id) as likes_count
          FROM posts p
          WHERE p.authorId IN (SELECT followingId FROM user_follows WHERE followerId = ?)
            AND (p.visibility = 'public' OR p.authorId = ?)
        `;
        const params = [uid, uid];
        
        if (cursor) {
          query += ` AND p.createdAt < ? `;
          params.push(parseInt(cursor));
        }
        
        query += ` ORDER BY p.createdAt DESC LIMIT ? `;
        params.push(limit);
        
        const { results } = await env.DB.prepare(query).bind(...params).all();
        
        const posts = results.map(row => ({
          id: row.id,
          caption: row.caption,
          description: row.description || "",
          visibility: row.visibility || "public",
          allowDownload: row.allowDownload !== undefined ? row.allowDownload : 1,
          imageUrl: row.imageUrl,
          authorId: row.authorId,
          authorName: row.authorName,
          authorAvatar: row.authorAvatar,
          createdAt: row.createdAt,
          likes: JSON.parse(row.likes || "[]").filter(x => x !== null)
        }));
        
        return new Response(JSON.stringify({ success: true, posts }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "GET" && url.pathname === "/notifications") {
        const { results } = await env.DB.prepare("SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 20")
          .bind(uid)
          .all();
          
        return new Response(JSON.stringify({ success: true, notifications: results }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "POST" && url.pathname === "/notifications/read") {
        await env.DB.prepare("UPDATE notifications SET read = 1 WHERE userId = ?")
          .bind(uid)
          .run();
          
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else if (request.method === "DELETE" && url.pathname === "/delete") {
        const fileToDelete = url.searchParams.get("file");
        if (!fileToDelete) {
          return new Response(JSON.stringify({ error: "Missing file parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const postPrefix = `posts/${uid}/`;
        const avatarPrefix = `avatars/${uid}/`;
        
        if (!fileToDelete.startsWith(postPrefix) && !fileToDelete.startsWith(avatarPrefix)) {
          return new Response(JSON.stringify({ error: "Forbidden: You can only delete your own files" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        await env.R2_BUCKET.delete(fileToDelete);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });

      } else {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: `Internal Server Error: ${err.message}` }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
