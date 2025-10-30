import { ensureAnonymousSession } from "./firebase.js";
import { resolveVariant, applyRoute } from "./router.js";
import { loadPostsForVariant, writeInteraction, listComments, addUserComment, generateComments, loadAllInteractions, subscribeComments, uploadMediaFile, createPost, deletePost, getPostLikeRepostCounts } from "./api.js";
import { startTimer, onTimerEnd } from "./timer.js";

let session = null;
let interactionsByPostId = {};
// Add to global vars
let repostedIds = []; // sessionStorage

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
  // Normal posts
  for (const post of posts) {
    container.appendChild(await renderPostCard(post));
  }
  // Session-local reposts (fake cards at bottom)
  for (const postId of repostedIds) {
    const post = posts.find(p => p.id === postId);
    if (post) {
      container.appendChild(await renderRepostCard(post));
    }
  }
}

async function renderPostCard(post) {
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
  const time = h("span", { class: "time" }, "· now");

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
      post.mediaUrl ? mediaEl(post) : null,
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

  await refreshComments(post.id);
  setupCommentsSubscription(post.id);
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
      originalPost.mediaUrl ? mediaEl(originalPost) : null
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

function mediaEl(post) {
  // Render YouTube/Shorts if link
  if ((post.mediaType === "youtube") || (typeof post.mediaUrl === "string" && post.mediaUrl.includes("youtube.com/embed"))) {
    // eslint-disable-next-line
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
    // Default to image (includes gif)
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
        try { await writeInteraction(session.sessionId, postId, { reposted: next }); } catch {}
        // Update session reposts & re-render feed
        repostedIds = loadReposts();
        if (next) {
          if (!repostedIds.includes(postId)) repostedIds.push(postId);
        } else {
          repostedIds = repostedIds.filter(id => id !== postId);
        }
        saveReposts();
        const variant = localStorage.getItem("sod_variant") || "mixed";
        renderFeed(variant);
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
        await deletePost(post.id, post.mediaUrl, session.sessionId);
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
  if (likeCountSpan) likeCountSpan.innerText = likeCount>0 ? String(likeCount) : '';
  const repostCountSpan = document.getElementById(`repostCount_${postId}`);
  if (repostCountSpan) repostCountSpan.innerText = repostCount>0 ? String(repostCount) : '';
}

async function main() {
  const variant = resolveVariant();
  applyRoute(variant);
  session = await ensureAnonymousSession(() => variant);
  interactionsByPostId = await loadAllInteractions(session.sessionId);
  await renderFeed(session.variant);
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

if(FAB) FAB.onclick = () => { modal.classList.remove("hidden"); };
if(closeBtn) closeBtn.onclick = () => { modal.classList.add("hidden"); resetNewPostModal(); };
function resetNewPostModal() {
  form.reset(); preview.innerHTML = ""; fileInput.value = ""; urlInput.value = ""; uploadedUrl = null; fileTypeHint = null;
}
let uploadedUrl = null;
let fileTypeHint = null;
if(fileInput) fileInput.onchange = async (e) => {
  preview.innerHTML = ""; uploadedUrl = null; fileTypeHint = null;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const type = file.type.startsWith("image") ? "image" : (file.type.startsWith("video") ? "video" : file.type === "image/gif" ? "gif" : null);
  if (!type) { preview.innerHTML = "<span style='color:red'>Unsupported type</span>"; return; }
  preview.innerHTML = "Uploading...";
  try {
    fileTypeHint = type;
    uploadedUrl = await uploadMediaFile(file, session.sessionId);
    if(type==="image" || type==="gif") preview.innerHTML = `<img src='${uploadedUrl}'>`;
    else if(type==="video") preview.innerHTML = `<video src='${uploadedUrl}' controls>`;
  } catch(e) { preview.innerHTML = `<span style='color:red'>${e.message}</span>`; uploadedUrl = null; }
};
if(urlInput) urlInput.oninput = () => {
  preview.innerHTML = ""; if(urlInput.value) fileInput.value=""; uploadedUrl = null; fileTypeHint = null;
  const url = urlInput.value.trim();
  if (url && (url.includes("youtube.com") || url.includes("youtu.be"))) {
    preview.innerHTML = `<iframe width='98%' style='aspect-ratio:16/9;border-radius:12px;border:1.5px solid #bde7fa;' src='${toYoutubeEmbed(url)}' frameborder='0' allowfullscreen></iframe>`;
    uploadedUrl = toYoutubeEmbed(url); fileTypeHint = "youtube";
  }
}
function toYoutubeEmbed(url) {
  if (!url) return url;
  // Match any YouTube/Shorts link
  // Try to extract video ID from regular, short, or shorts
  let vid = url.match(/(?:v=|youtu.be\/|shorts\/)([\w-]{11})/);
  if (!vid) return url;
  return `https://www.youtube.com/embed/${vid[1]}`;
}
if(form) form.onsubmit = async (e) => {
  e.preventDefault();
  // Ensure text or media is present
  const text = document.getElementById("post-text").value.trim();
  if (!text) { alert("Post text required"); return; }
  let mediaUrl = uploadedUrl;
  let mediaType = fileTypeHint;
  if(!mediaUrl) { mediaType = "text"; }
  // Author and stance
  const author = session && session.sessionId ? `user_${session.sessionId.substr(-6)}` : "anon";
  const stance = session && session.variant ? session.variant : "mixed";
  try {
    await createPost({ text, mediaUrl, mediaType, author, stance });
    modal.classList.add("hidden"); resetNewPostModal();
    // re-render feed to show new post
    const variant = localStorage.getItem("sod_variant") || "mixed";
    renderFeed(variant);
  } catch(e) {
    alert("Failed to publish post: " + e.message);
  }
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
  let mediaUrl = adminUploadUrl;
  let mediaType = adminFileType;
  if (!mediaUrl) { mediaType = "text"; }
  try {
    await createPost({ text, mediaUrl, mediaType, author, stance });
    adminModal.classList.add("hidden"); resetAdminModal();
    // re-render feed to show new post
    const variant = localStorage.getItem("sod_variant") || "mixed";
    renderFeed(variant);
  } catch (e) {
    alert("Failed to publish admin post: " + e.message);
  }
};


