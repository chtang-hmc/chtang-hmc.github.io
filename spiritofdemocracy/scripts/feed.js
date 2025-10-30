import { ensureAnonymousSession } from "./firebase.js";
import { resolveVariant, applyRoute } from "./router.js";
import { loadPostsForVariant, writeInteraction, listComments, addUserComment, generateComments, loadAllInteractions, subscribeComments, uploadMediaFile, createPost, deletePost, getPostLikeRepostCounts, subscribeToPostsForVariant, createRepost, deleteRepostByAuthor } from "./api.js";
import { startTimer, onTimerEnd } from "./timer.js";

let session = null;
let interactionsByPostId = {};
// Add to global vars
let repostedIds = []; // sessionStorage

let unsubscribePosts = null;
let currentFeedPostsVariant = null;

// Call this function when (re)loading the feed.
function listenToFeedPosts(variant) {
  if (unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
  currentFeedPostsVariant = variant;
  unsubscribePosts = subscribeToPostsForVariant(variant, showPosts);
}
async function showPosts(posts) {
  const container = document.getElementById("feed");
  if (!container) return;
  container.innerHTML = "";
  repostedIds = loadReposts(); // session repost ids
  // First, render all post cards (without waiting for comments)
  const postCards = [];
  for (const post of posts) {
    const card = await renderPostCard(post, false); // false = don't load comments yet
    container.appendChild(card);
    postCards.push(post);
  }
  // Update all visible .posttime spans now
  updateVisibleTimes();
  // Now batch-load all comments in parallel
  await Promise.all(postCards.map(post => refreshComments(post.id)));
  // Set up subscriptions for all posts
  postCards.forEach(post => setupCommentsSubscription(post.id));
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v); else if (k === "aria-pressed") el.setAttribute("aria-pressed", v); else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function getInitials(author) {
  if (!author || typeof author !== "string") return "?";
  return author.trim().slice(0, 2).toUpperCase();
}

function displayNameFromAuthor(author) {
  if (!author) return "Unknown";
  return author.replace(/_([a-z])/g, (_, x) => ` ${x.toUpperCase()}`).replace(/(^| )([a-z])/g, m => m.toUpperCase());
}

function handleFromAuthor(author) {
  if (!author) return "@user";
  return "@" + author.toLowerCase();
}

function saveReposts() {
  sessionStorage.setItem("sod_reposts", JSON.stringify(repostedIds));
}
function loadReposts() {
  try {
    return JSON.parse(sessionStorage.getItem("sod_reposts")) || [];
  } catch { return []; }
}

async function renderFeed(variant) {
  const container = document.getElementById("feed");
  container.innerHTML = "";
  const posts = await loadPostsForVariant(variant);
  repostedIds = loadReposts(); // load current session repost ids
  // First, render all post cards (without waiting for comments)
  const postCards = [];
  for (const post of posts) {
    container.appendChild(await renderPostCard(post, false));
    postCards.push(post);
  }
  // Session-local reposts (fake cards at bottom) - legacy, may not be needed with public reposts
  for (const postId of repostedIds) {
    const post = posts.find(p => p.id === postId);
    if (post) {
      container.appendChild(await renderRepostCard(post));
    }
  }
  // Batch-load all comments in parallel
  await Promise.all(postCards.map(post => refreshComments(post.id)));
  // Set up subscriptions for all posts
  postCards.forEach(post => setupCommentsSubscription(post.id));
}

function getPostTime(post) {
  if (post.createdAt && post.createdAt.toDate) {
    return post.createdAt.toDate();
  }
  if (post.createdAt && typeof post.createdAt === 'number') {
    return new Date(post.createdAt);
  }
  if (post.__static && typeof window.__staticPostOffset === 'number') {
    return new Date(Date.now() - 86400000 * (window.__staticPostOffset++));
  }
  return new Date(0); // Epoch fallback
}
function formatTimeAgo(date) {
  const now = new Date();
  const s = Math.floor((now - date) / 1000);
  if (s < 30) return 'Just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function updateVisibleTimes() {
  document.querySelectorAll('.posttime[data-timestamp]').forEach(el => {
    const ts = Number(el.getAttribute('data-timestamp'));
    if (!isNaN(ts)) el.textContent = formatTimeAgo(new Date(ts));
  });
}
setInterval(updateVisibleTimes, 20000);
window.__staticPostOffset = 1;

async function renderPostCard(post, loadComments = true) {
  // Public repost rendering
  if (post.type === "repost" && post.repostOriginal) {
    return await renderRepostCardPublic(post);
  }
  const likedKey = `liked_${post.id}`;
  const repostedKey = `reposted_${post.id}`;
  const initial = interactionsByPostId[post.id] || {};
  const liked = initial.liked === true || sessionStorage.getItem(likedKey) === "1";
  const reposted = initial.reposted === true || sessionStorage.getItem(repostedKey) === "1";
  const isMine = session && session.sessionId && (post.author === `user_${session.sessionId.substr(-6)}`);
  // Twitter/X look: avatar, meta, styled content, media, actions
  const avatar = h("div", { class: "avatar", title: displayNameFromAuthor(post.author) }, getInitials(post.author));
  const display = displayNameFromAuthor(post.author);
  const handle = handleFromAuthor(post.author);
  const t = getPostTime(post);
  const time = h("span", { class: "time posttime", "data-timestamp": t.getTime() }, formatTimeAgo(t));

  const card = h("div", { class: "card" },
    avatar,
    h("div", { class: "content" },
      h("div", { class: "meta" },
        h("span", { class: "displayName" }, display),
        h("span", { class: "handle" }, handle),
        time,
        (isMine && !post.__static) ? deleteBtn(post) : null
      ),
      h("div", { class: "text" }, post.text || ""),
      ((post.media && Array.isArray(post.media) && post.media.length > 0) || post.mediaUrl) ? mediaEl(post) : null,
      h("div", { class: "actions", id: `actions_${post.id}` },
        likeBtn(post.id, liked),
        h("span", { class: "counter", id: `likeCount_${post.id}` }, ''),
        repostBtn(post.id, reposted),
        h("span", { class: "counter", id: `repostCount_${post.id}` }, ''),
        genBtn(post.id),
      ),
      h("div", { class: "comments", id: `comments_${post.id}` }),
      commentForm(post.id)
    )
  );

  if (loadComments) {
    await refreshComments(post.id);
    setupCommentsSubscription(post.id);
  }
  // After rendering, fetch counts
  setTimeout(() => updateLikeRepostCounts(post.id), 0);
  return card;
}

// Specialized repost rendering (quoted style)
async function renderRepostCard(originalPost) {
  // We'll use the session user as author
  const youName = "You";
  const youHandle = session && session.sessionId ? "@user_"+session.sessionId.substr(-6) : "@you";
  const quoteCard = h("div", { class: "card", style: "margin-top:12px;margin-bottom:4px;background:#f7fafd;border:1.4px solid #e6ecf0;" },
    h("div", { class: "avatar", style: "opacity:0.80;" }, getInitials(originalPost.author)),
    h("div", { class: "content" },
      h("div", { class: "meta" },
        h("span", { class: "displayName" }, displayNameFromAuthor(originalPost.author)),
        h("span", { class: "handle" }, handleFromAuthor(originalPost.author)),
        // stance hidden
      ),
      h("div", { class: "text" }, originalPost.text || ""),
      ((originalPost.media && Array.isArray(originalPost.media) && originalPost.media.length > 0) || originalPost.mediaUrl) ? mediaEl(originalPost) : null
    )
  );
  const card = h("div", { class: "card repost-card" },
    h("div", { class: "avatar", title: youName, style: "background:#b3b3b3;" }, youName.slice(0,2).toUpperCase()),
    h("div", { class: "content" },
      h("div", { class: "meta" },
        h("span", { class: "displayName" }, youName),
        h("span", { class: "handle" }, youHandle),
        h("span", { class: "time", style: "color:#2cbeff;padding-left:5px;" }, "· Reposted by you")
      ),
      h("div", { style: "margin:8px 0 0 0;" }, quoteCard)
    )
  );
  return card;
}

async function renderRepostCardPublic(repostPost) {
  const originalPost = repostPost.repostOriginal || {};
  const reposterName = displayNameFromAuthor(repostPost.author);
  const reposterHandle = handleFromAuthor(repostPost.author);
  const quoteCard = h("div", { class: "card", style: "margin-top:12px;margin-bottom:4px;background:#f7fafd;border:1.4px solid #e6ecf0;" },
    h("div", { class: "avatar", style: "opacity:0.80;" }, getInitials(originalPost.author)),
    h("div", { class: "content" },
      h("div", { class: "meta" },
        h("span", { class: "displayName" }, displayNameFromAuthor(originalPost.author)),
        h("span", { class: "handle" }, handleFromAuthor(originalPost.author)),
      ),
      h("div", { class: "text" }, originalPost.text || ""),
      ((originalPost.media && Array.isArray(originalPost.media) && originalPost.media.length > 0) || originalPost.mediaUrl) ? mediaEl(originalPost) : null
    )
  );
  const card = h("div", { class: "card repost-card" },
    h("div", { class: "avatar", title: reposterName, style: "background:#b3b3b3;" }, reposterName.slice(0,2).toUpperCase()),
    h("div", { class: "content" },
      h("div", { class: "meta" },
        h("span", { class: "displayName" }, reposterName),
        h("span", { class: "handle" }, reposterHandle),
        h("span", { class: "time", style: "color:#2cbeff;padding-left:5px;" }, "· Reposted")
      ),
      h("div", { style: "margin:8px 0 0 0;" }, quoteCard)
    )
  );
  return card;
}

function mediaEl(post) {
  // Prefer new media array
  if (post.media && Array.isArray(post.media) && post.media.length > 0) {
    // Images (1-4)
    if (post.mediaType === "images" || (post.mediaType === "gif" && post.media.length > 0)) {
      const grid = document.createElement("div");
      grid.className = "feed-gallery";
      post.media.slice(0,4).forEach(url => {
        const im = document.createElement("img");
        im.src = url;
        im.alt = "";
        im.className = "gallery-img";
        grid.appendChild(im);
      });
      return grid;
    }
    // Video (single only)
    if (post.mediaType === "video" && post.media.length === 1) {
      const v = document.createElement("video");
      v.controls = true;
      v.className = "gallery-video";
      v.src = post.media[0];
      return v;
    }
    // Youtube (single)
    if (post.mediaType === "youtube" && post.media.length === 1) {
      const f = document.createElement("iframe");
      f.src = post.media[0];
      f.width = "100%";
      f.style = "aspect-ratio:16/9;border-radius:12px;border:1.5px solid #e6ecf0;";
      f.setAttribute('frameborder', '0');
      f.setAttribute('allowfullscreen', 'true');
      return f;
    }
  }
  // Fallback for old posts
  if ((post.mediaType === "youtube") || (typeof post.mediaUrl === "string" && post.mediaUrl.includes("youtube.com/embed"))) {
    return h("div", { class: "media" },
      h("iframe", {
        src: post.mediaUrl,
        width: "100%",
        style: "aspect-ratio:16/9;border-radius:12px;border:1.5px solid #e6ecf0;",
        frameborder: "0",
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        allowfullscreen: true
      })
    );
  }
  if (post.mediaType === "video" || (post.mediaUrl && /\.mp4|\.webm$/.test(post.mediaUrl))) {
    const v = h("video", { controls: true });
    v.appendChild(h("source", { src: post.mediaUrl }));
    return h("div", { class: "media" }, v);
  }
  if (post.mediaUrl) {
    return h("div", { class: "media" }, h("img", { src: post.mediaUrl, alt: "" }));
  }
  return null;
}

function likeBtn(postId, liked) {
  // Use heart icon (SVG)
  return h(
    "button",
    {
      class: "btn" + (liked ? " active" : ""),
      "aria-pressed": liked ? "true" : "false",
      title: liked ? "Liked" : "Like",
      onClick: async (e) => {
        const key = `liked_${postId}`;
        const next = !(sessionStorage.getItem(key) === "1");
        e.currentTarget.setAttribute("aria-pressed", next ? "true" : "false");
        e.currentTarget.classList.toggle("active", next);
        sessionStorage.setItem(key, next ? "1" : "0");
        try { await writeInteraction(session.sessionId, postId, { liked: next }); } catch {}
        updateLikeRepostCounts(postId);
      },
    },
    liked
      ? "♥ Like"
      : "♡ Like"
  );
}

// Patch repostBtn to mutate repostedIds and re-render
function repostBtn(postId, reposted) {
  return h(
    "button",
    {
      class: "btn" + (reposted ? " active" : ""),
      "aria-pressed": reposted ? "true" : "false",
      title: reposted ? "Reposted" : "Repost",
      onClick: async (e) => {
        const key = `reposted_${postId}`;
        const next = !(sessionStorage.getItem(key) === "1");
        e.currentTarget.setAttribute("aria-pressed", next ? "true" : "false");
        e.currentTarget.classList.toggle("active", next);
        sessionStorage.setItem(key, next ? "1" : "0");
        try {
          await writeInteraction(session.sessionId, postId, { reposted: next });
          // Create or delete public repost
          if (next) {
            // Find the original post object in current feed (best-effort)
            const container = document.getElementById("feed");
            let original = null;
            // We don't keep a global map; rely on last showPosts arg through closure isn't available.
            // Instead, fetch a minimal snapshot via loadPostsForVariant and pick by id.
            const variant = localStorage.getItem("sod_variant") || "mixed";
            const posts = await loadPostsForVariant(variant);
            original = posts.find(p => p.id === postId) || { id: postId };
            const author = session && session.sessionId ? `user_${session.sessionId.substr(-6)}` : "anon";
            await createRepost(original, author);
          } else {
            const author = session && session.sessionId ? `user_${session.sessionId.substr(-6)}` : "anon";
            await deleteRepostByAuthor(postId, author);
          }
          // Re-render feed to reflect changes
          const variant = localStorage.getItem("sod_variant") || "mixed";
          renderFeed(variant);
        } catch {}
        updateLikeRepostCounts(postId);
      },
    },
    reposted ? "🔁 Repost" : "⤴ Repost"
  );
}

function genBtn(postId) {
  return h(
    "button",
    { class: "btn", title: "Generate AI Replies", onClick: async () => {
        try {
          const res = await generateComments(postId, 3);
          await refreshComments(postId);
        } catch (e) {
          console.error(e);
          alert("Failed to generate comments.");
        }
      } },
    "💬 AI"
  );
}

function deleteBtn(post) {
  return h("button", { class: "btn", title: "Delete", style: "margin-left:auto;font-size:17px;padding:4px 8px;color:#e81c4f;", onClick: async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("Delete this post? This cannot be undone.")) {
      try {
        const mediaUrls = (post.media && Array.isArray(post.media) && post.media.length > 0)
          ? post.media
          : (post.mediaUrl ? [post.mediaUrl] : []);
        await deletePost(post.id, mediaUrls, session.sessionId);
        // Re-render feed without this post
        const variant = localStorage.getItem("sod_variant") || "mixed";
        renderFeed(variant);
      } catch (err) {
        alert("Delete failed: " + (err.message || err));
      }
    }
  } }, "🗑");
}

function commentForm(postId) {
  const input = h("input", { type: "text", placeholder: "Write a comment…", style: "width:100%" });
  const send = h("button", { class: "btn" }, "Reply");
  const row = h("div", { class: "actions" }, input, send);
  send.addEventListener("click", async () => {
    const text = (input.value || "").trim();
    if (!text) return;
    // optimistic UI
    const container = document.getElementById(`comments_${postId}`);
    if (container) {
      container.appendChild(h("div", { class: "comment" },
        h("div", { class: "src" }, "User"),
        h("div", {}, text)
      ));
    }
    input.value = "";
    try {
      await addUserComment(postId, session.sessionId, text);
      await refreshComments(postId);
    } catch (e) {
      console.error(e);
    }
  });
  return row;
}

function setupCommentsSubscription(postId) {
  const container = document.getElementById(`comments_${postId}`);
  if (!container) return;
  subscribeComments(postId, (comments) => {
    container.innerHTML = "";
    for (const c of comments) {
      const el = h("div", { class: "comment" },
        h("div", { class: "src" }, c.source === "gemini" ? "AI" : "User"),
        h("div", {}, c.text || "")
      );
      container.appendChild(el);
    }
  });
}

async function refreshComments(postId) {
  const container = document.getElementById(`comments_${postId}`);
  if (!container) return;
  const comments = await listComments(postId);
  container.innerHTML = "";
  for (const c of comments) {
    const el = h("div", { class: "comment" },
      h("div", { class: "src" }, c.source === "gemini" ? "AI" : "User"),
      h("div", {}, c.text || "")
    );
    container.appendChild(el);
  }
}

async function updateLikeRepostCounts(postId) {
  const { likeCount, repostCount } = await getPostLikeRepostCounts(postId);
  const likeCountSpan = document.getElementById(`likeCount_${postId}`);
  if (likeCountSpan) likeCountSpan.innerText = likeCount !== undefined ? String(likeCount) : '0';
  const repostCountSpan = document.getElementById(`repostCount_${postId}`);
  if (repostCountSpan) repostCountSpan.innerText = repostCount !== undefined ? String(repostCount) : '0';
}

async function main() {
  const variant = resolveVariant();
  applyRoute(variant);
  session = await ensureAnonymousSession(() => variant);
  interactionsByPostId = await loadAllInteractions(session.sessionId);
  listenToFeedPosts(variant);
  const durationMs = location.hostname === "localhost" ? 30 * 1000 : 3 * 60 * 1000;
  startTimer(durationMs);
  onTimerEnd(() => {
    const modal = document.getElementById("poll-modal");
    modal.classList.remove("hidden");
  });
}

window.addEventListener("DOMContentLoaded", main);

const FAB = document.getElementById("fab-new-post");
const modal = document.getElementById("modal-new-post");
const form = document.getElementById("new-post-form");
const fileInput = document.getElementById("post-media");
const urlInput = document.getElementById("post-media-url");
const closeBtn = document.getElementById("cancel-new-post");
const preview = document.getElementById("post-media-preview");

let postMediaFiles = [];
let postMediaType = null;
let postMediaYoutubeUrl = '';
const gallery = document.getElementById("post-media-gallery");
const dropzone = document.getElementById("media-dropzone");
const addMediaBtn = document.getElementById("add-media-btn");
let dragover = false;

const errorDiv = document.getElementById("post-modal-error");

function clearPostModalError() { if (errorDiv) errorDiv.innerText = ""; }
function showPostModalError(msg) { if (errorDiv) errorDiv.innerText = msg; }

if(FAB) FAB.onclick = () => { modal.classList.remove("hidden"); };
if (closeBtn) closeBtn.onclick = () => { modal.classList.add("hidden"); clearPostModalError(); resetNewPostModal(); };
function resetNewPostModal() {
  form.reset(); preview.innerHTML = ""; fileInput.value = ""; urlInput.value = ""; uploadedUrl = null; fileTypeHint = null;
}
let uploadedUrl = null;
let fileTypeHint = null;
if (fileInput) fileInput.onchange = (e) => {
  gallery.innerHTML = "";
  postMediaFiles = [];
  postMediaType = null;
  let files = Array.from(e.target.files);
  if (files.length === 0) return;
  // Check if only video or up to 4 images, never mix
  let hasVideo = files.some(f => f.type.startsWith('video'));
  if (hasVideo && files.length > 1) {
    alert('Only one video per post allowed'); fileInput.value = ''; return;
  }
  if (!hasVideo && files.length > 4) {
    alert('Max 4 images/gifs per post!'); fileInput.value = ''; return;
  }
  // Only keep images if has video, or images; can't mix
  if (hasVideo) files = files.filter(f => f.type.startsWith('video'));
  else files = files.filter(f => f.type.startsWith('image'));
  postMediaFiles = files;
  postMediaType = hasVideo ? 'video' : 'images';
  // Render thumbs
  files.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = "media-thumb";
    let previewEl;
    if (file.type.startsWith('image')) {
      previewEl = document.createElement('img');
      previewEl.src = URL.createObjectURL(file);
    } else if (file.type.startsWith('video')) {
      previewEl = document.createElement('video'); previewEl.controls = false; previewEl.src = URL.createObjectURL(file);
    }
    thumb.appendChild(previewEl);
    const rm = document.createElement('button');
    rm.className = "remove-thumb"; rm.innerText = "×";
    rm.onclick = () => {
      postMediaFiles.splice(i, 1); // Remove ith file and retrigger
      renderMediaGallery();
      // Also clear fileInput to flush input state
      fileInput.value = '';
    };
    thumb.appendChild(rm);
    gallery.appendChild(thumb);
  });
};
if (addMediaBtn && fileInput) {
  addMediaBtn.onclick = () => fileInput.click();
}
// Update drag-and-drop to focus gallery and highlight dropzone
if (dropzone && fileInput) {
  dropzone.ondragover = (e) => { e.preventDefault(); dragover = true; dropzone.classList.add('dragover'); gallery.classList.add('dragover'); };
  dropzone.ondragleave = (e) => { dragover = false; dropzone.classList.remove('dragover'); gallery.classList.remove('dragover'); };
  dropzone.ondrop = (e) => {
    e.preventDefault(); dropzone.classList.remove('dragover'); gallery.classList.remove('dragover');
    clearPostModalError();
    const dt = e.dataTransfer;
    if (!dt || !dt.files) return;
    let files = Array.from(dt.files);
    let hasVideo = files.some(f => f.type.startsWith('video'));
    if (hasVideo && files.length > 1) {
      showPostModalError('Only one video per post allowed'); return;
    }
    if (!hasVideo && files.length > 4) {
      showPostModalError('Max 4 images/gifs per post!'); return;
    }
    if (hasVideo) files = files.filter(f => f.type.startsWith('video'));
    else files = files.filter(f => f.type.startsWith('image'));
    postMediaFiles = files;
    postMediaType = hasVideo ? 'video' : 'images';
    renderMediaGallery();
    fileInput.value = '';
  };
}
// Enhance renderMediaGallery to scroll gallery into view when a new image is added
function renderMediaGallery() {
  gallery.innerHTML = "";
  postMediaFiles.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = "media-thumb";
    let previewEl;
    if (file.type.startsWith('image')) {
      previewEl = document.createElement('img');
      previewEl.src = URL.createObjectURL(file);
    } else if (file.type.startsWith('video')) {
      previewEl = document.createElement('video'); previewEl.controls = false; previewEl.src = URL.createObjectURL(file);
    }
    thumb.appendChild(previewEl);
    const rm = document.createElement('button');
    rm.className = "remove-thumb"; rm.innerText = "×";
    rm.onclick = () => {
      postMediaFiles.splice(i, 1);
      renderMediaGallery();
      fileInput.value = '';
    };
    thumb.appendChild(rm);
    gallery.appendChild(thumb);
  });
  if (gallery.children.length > 0) {
    gallery.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
// Youtube
if(urlInput) urlInput.oninput = () => {
  gallery.innerHTML = ""; if(urlInput.value) fileInput.value=""; postMediaYoutubeUrl = '';
  const url = urlInput.value.trim();
  if (url && (url.includes("youtube.com") || url.includes("youtu.be") || url.includes("shorts/"))) {
    gallery.innerHTML = `<iframe width='98%' style='aspect-ratio:16/9;border-radius:12px;border:1.5px solid #bde7fa;' src='${toYoutubeEmbed(url)}' frameborder='0' allowfullscreen></iframe>`;
    postMediaYoutubeUrl = toYoutubeEmbed(url);
    postMediaType = "youtube";
    postMediaFiles = [];
    fileInput.value = '';
  }
}

if(form) form.onsubmit = async (e) => {
  e.preventDefault();
  clearPostModalError();
  const text = document.getElementById("post-text").value.trim();
  let validMedia = (postMediaFiles && postMediaFiles.length > 0) || postMediaYoutubeUrl;
  if (!text && !validMedia) {
    showPostModalError("Please enter text or attach images/video!");
    return;
  }
  // Ensure we have an authenticated anonymous session before uploading
  if (!session || !session.sessionId) {
    const variant = localStorage.getItem("sod_variant") || "mixed";
    session = await ensureAnonymousSession(() => variant);
  }
  let mediaUrls = [], mediaType = postMediaType;
  try {
    if (postMediaFiles && postMediaFiles.length > 0) {
      const uploads = postMediaFiles.map(f => uploadMediaFile(f, session.sessionId));
      mediaUrls = await Promise.all(uploads);
    } else if (postMediaYoutubeUrl) {
      mediaUrls = [postMediaYoutubeUrl];
      mediaType = "youtube";
    }
    if (mediaType === null && !validMedia) mediaType = "text";
    const author = session && session.sessionId ? `user_${session.sessionId.substr(-6)}` : "anon";
    const stance = session && session.variant ? session.variant : "mixed";
    await createPost({ text, media: mediaUrls, mediaType, author, stance });
    modal.classList.add("hidden");
    form.reset();
    gallery.innerHTML = "";
    clearPostModalError();
    postMediaFiles = []; postMediaYoutubeUrl = ''; postMediaType = null; fileInput.value=''; urlInput.value='';
  } catch(e) { showPostModalError("Failed to publish post: " + e.message); }
};

function showIfLocal(id) {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    const el = document.getElementById(id); if (el) el.style.display = "flex";
  }
}
showIfLocal("fab-admin-post");
// Admin post modal logic
const adminFAB = document.getElementById("fab-admin-post");
const adminModal = document.getElementById("modal-admin-post");
const adminForm = document.getElementById("admin-post-form");
const adminClose = document.getElementById("cancel-admin-post");
const adminPrev = document.getElementById("admin-post-media-preview");
const adminFile = document.getElementById("admin-post-media");
const adminUrl = document.getElementById("admin-post-media-url");
let adminUploadUrl = null;
let adminFileType = null;
if (adminFAB) adminFAB.onclick = () => { adminModal.classList.remove("hidden"); };
if (adminClose) adminClose.onclick = () => { adminModal.classList.add("hidden"); resetAdminModal(); };
function resetAdminModal() { if(adminForm)adminForm.reset(); adminPrev.innerHTML = ""; adminUploadUrl = null; adminFileType = null; }
if (adminFile) adminFile.onchange = async (e) => {
  adminPrev.innerHTML = ""; adminUploadUrl = null;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const type = file.type.startsWith("image") ? "image" : (file.type.startsWith("video") ? "video" : file.type === "image/gif" ? "gif" : null);
  if (!type) { adminPrev.innerHTML = "<span style='color:red'>Unsupported type</span>"; return; }
  adminPrev.innerHTML = "Uploading...";
  try {
    // Ensure session for storage upload
    if (!session || !session.sessionId) {
      const variant = localStorage.getItem("sod_variant") || "mixed";
      session = await ensureAnonymousSession(() => variant);
    }
    adminFileType = type;
    adminUploadUrl = await uploadMediaFile(file, session.sessionId);
    if(type==="image"||type==="gif") adminPrev.innerHTML = `<img src='${adminUploadUrl}'>`;
    else if(type==="video") adminPrev.innerHTML = `<video src='${adminUploadUrl}' controls>`;
  } catch(e) { adminPrev.innerHTML = `<span style='color:red'>${e.message}</span>`; adminUploadUrl = null; }
};
if (adminUrl) adminUrl.oninput = () => {
  adminPrev.innerHTML = ""; if(adminUrl.value) adminFile.value=""; adminUploadUrl = null; adminFileType = null;
  const url = adminUrl.value.trim();
  if (url && (url.includes("youtube.com") || url.includes("youtu.be") || url.includes("shorts/"))) {
    adminPrev.innerHTML = `<iframe width='98%' style='aspect-ratio:16/9;border-radius:12px;border:1.5px solid #bde7fa;' src='${toYoutubeEmbed(url)}' frameborder='0' allowfullscreen></iframe>`;
    adminUploadUrl = toYoutubeEmbed(url); adminFileType = "youtube";
  }
}
if(adminForm) adminForm.onsubmit = async (e) => {
  e.preventDefault();
  const text = document.getElementById("admin-post-text").value.trim();
  const stance = document.getElementById("admin-post-stance").value;
  const author = document.getElementById("admin-post-author").value.trim();
  if (!text || !stance || !author) { alert("All fields required"); return; }
  // Ensure session before any writes
  if (!session || !session.sessionId) {
    const variant = localStorage.getItem("sod_variant") || "mixed";
    session = await ensureAnonymousSession(() => variant);
  }
  let mediaUrl = adminUploadUrl;
  let mediaType = adminFileType;
  if (!mediaUrl) { mediaType = "text"; }
  try {
    await createPost({ text, media: mediaUrl ? [mediaUrl] : [], mediaType, author, stance });
    adminModal.classList.add("hidden"); resetAdminModal();
    const variant = localStorage.getItem("sod_variant") || "mixed";
    listenToFeedPosts(variant);
  } catch (e) {
    alert("Failed to publish admin post: " + e.message);
  }
};



