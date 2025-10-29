import { ensureAnonymousSession } from "./firebase.js";
import { resolveVariant, applyRoute } from "./router.js";
import { loadPostsForVariant, writeInteraction, listComments, addUserComment, generateComments, loadAllInteractions, subscribeComments } from "./api.js";
import { startTimer, onTimerEnd } from "./timer.js";

let session = null;
let interactionsByPostId = {};

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

async function renderFeed(variant) {
  const container = document.getElementById("feed");
  container.innerHTML = "";
  const posts = await loadPostsForVariant(variant);
  for (const post of posts) {
    container.appendChild(await renderPostCard(post));
  }
}

async function renderPostCard(post) {
  const likedKey = `liked_${post.id}`;
  const repostedKey = `reposted_${post.id}`;
  const initial = interactionsByPostId[post.id] || {};
  const liked = initial.liked === true || sessionStorage.getItem(likedKey) === "1";
  const reposted = initial.reposted === true || sessionStorage.getItem(repostedKey) === "1";

  const card = h("div", { class: "card" },
    h("div", { class: "avatar" }),
    h("div", { class: "content" },
      h("div", { class: "meta" }, h("span", {}, `@user_${post.author || "anon"}`), h("span", {}, "·"), h("span", {}, post.stance.toUpperCase())),
      h("div", { class: "text" }, post.text || ""),
      post.mediaUrl ? mediaEl(post) : null,
      h("div", { class: "actions" },
        likeBtn(post.id, liked),
        repostBtn(post.id, reposted),
        genBtn(post.id),
      ),
      h("div", { class: "comments", id: `comments_${post.id}` }),
      commentForm(post.id)
    )
  );

  setupCommentsSubscription(post.id);
  return card;
}

function mediaEl(post) {
  if (post.type === "video") {
    const v = h("video", { controls: true });
    v.appendChild(h("source", { src: post.mediaUrl }));
    return h("div", { class: "media" }, v);
  }
  return h("div", { class: "media" }, h("img", { src: post.mediaUrl, alt: "" }));
}

function likeBtn(postId, liked) {
  return h("button", { class: "btn" + (liked ? " active" : ""), "aria-pressed": liked ? "true" : "false", onClick: async (e) => {
    const key = `liked_${postId}`;
    const next = !(sessionStorage.getItem(key) === "1");
    // immediate UI
    e.currentTarget.setAttribute("aria-pressed", next ? "true" : "false");
    e.currentTarget.classList.toggle("active", next);
    sessionStorage.setItem(key, next ? "1" : "0");
    // backend write (fire and forget)
    try { await writeInteraction(session.sessionId, postId, { liked: next }); } catch {}
  } }, "Like");
}

function repostBtn(postId, reposted) {
  return h("button", { class: "btn" + (reposted ? " active" : ""), "aria-pressed": reposted ? "true" : "false", onClick: async (e) => {
    const key = `reposted_${postId}`;
    const next = !(sessionStorage.getItem(key) === "1");
    // immediate UI
    e.currentTarget.setAttribute("aria-pressed", next ? "true" : "false");
    e.currentTarget.classList.toggle("active", next);
    sessionStorage.setItem(key, next ? "1" : "0");
    // backend write (fire and forget)
    try { await writeInteraction(session.sessionId, postId, { reposted: next }); } catch {}
  } }, "Repost");
}

function genBtn(postId) {
  return h("button", { class: "btn", onClick: async () => {
    try {
      const res = await generateComments(postId, 3);
      await refreshComments(postId);
    } catch (e) {
      console.error(e);
      alert("Failed to generate comments.");
    }
  } }, "Generate comments");
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


