import { auth, db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp, addDoc, onSnapshot, deleteDoc, collectionGroup } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

export async function loadPostsForVariant(variant) {
  // 1. Load user posts from Firestore
  const userPosts = [];
  const col = collection(db, "posts");
  let fb = [];
  try {
    const qs = await getDocs(col);
    fb = qs.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {}
  // Only include posts for this variant (PRO=> PRO+MIXED, AGAINST=> AGAINST+MIXED, MIXED=> all)
  const allowed = (p) => {
    if (variant === "pro") return p.stance === "pro" || p.stance === "mixed";
    if (variant === "against") return p.stance === "against" || p.stance === "mixed";
    return p.stance === "pro" || p.stance === "against" || p.stance === "mixed";
  };
  // 2. Load static
  let staticPosts = [];
  try {
    const res = await fetch("./data/posts.json");
    staticPosts = (await res.json()).map(p => ({ ...p, __static: true, createdAt: { toMillis() { return 0; } } }));
  } catch {}
  // 3. Merge and sort
  const posts = [...fb.filter(allowed), ...staticPosts.filter(allowed)];
  return posts.sort((a,b) => {
    // prefer createdAt if present
    const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
}

export async function writeInteraction(sessionId, postId, updates) {
  const ref = doc(db, `sessions/${sessionId}/interactions/${postId}`);
  await setDoc(ref, { ...updates, updatedAt: serverTimestamp() }, { merge: true });
}

export async function submitPoll(ownerUid, variant, answer) {
  const coll = collection(db, "polls");
  await addDoc(coll, { ownerUid, variant, answer, submittedAt: serverTimestamp() });
}

export async function addUserComment(postId, sessionId, text) {
  const ref = collection(db, `posts/${postId}/comments`);
  return addDoc(ref, { text, source: "user", sessionId, createdAt: serverTimestamp() });
}

export async function listComments(postId) {
  const ref = collection(db, `posts/${postId}/comments`);
  const qs = await getDocs(ref);
  return qs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return ta - tb;
  });
}

export async function generateComments(postId, count = 3) {
  const callable = httpsCallable(functions, "generateComments");
  const result = await callable({ postId, count });
  return result.data;
}

export async function loadAllInteractions(sessionId) {
  const ref = collection(db, `sessions/${sessionId}/interactions`);
  const qs = await getDocs(ref);
  const map = {};
  qs.forEach(docSnap => { map[docSnap.id] = docSnap.data(); });
  return map;
}

export async function uploadMediaFile(file, sessionId, progressCb) {
  if (!file) throw new Error('No file');
  if (file.size > 15 * 1024 * 1024) throw new Error('File too large (max 15MB)');
  const contentType = file.type;
  const ext = file.name.split('.').pop() || '';
  const filename = `media_${Date.now()}.${ext}`;
  const storage = getStorage();
  const path = `uploads/${sessionId}/${filename}`;
  const fileRef = storageRef(storage, path);
  // Upload with progress (optional)
  await uploadBytesResumable(fileRef, file, { contentType });
  return await getDownloadURL(fileRef);
}

export async function createPost({ text, media = [], mediaType = "text", author, stance }) {
  const coll = collection(db, "posts");
  return addDoc(coll, {
    text,
    media,        // array of URLs ([] if text-only)
    mediaType,    // 'images' | 'video' | 'youtube' | 'text'
    author,
    stance,
    createdAt: serverTimestamp(),
  });
}

export async function createRepost(originalPost, author) {
  const coll = collection(db, "posts");
  const stance = originalPost.stance || "mixed";
  const repostDoc = {
    type: "repost",
    repostOfId: originalPost.id,
    repostOriginal: {
      id: originalPost.id,
      text: originalPost.text || "",
      author: originalPost.author || "",
      media: Array.isArray(originalPost.media) ? originalPost.media : (originalPost.mediaUrl ? [originalPost.mediaUrl] : []),
      mediaType: originalPost.mediaType || (originalPost.mediaUrl ? (/(mp4|webm)$/i.test(originalPost.mediaUrl) ? "video" : "images") : "text"),
      stance: stance,
    },
    author, // reposter
    stance, // use original stance for filtering
    createdAt: serverTimestamp(),
  };
  return addDoc(coll, repostDoc);
}

export async function deleteRepostByAuthor(originalPostId, author) {
  const coll = collection(db, "posts");
  const q = query(coll, where("type", "==", "repost"), where("repostOfId", "==", originalPostId), where("author", "==", author));
  const qs = await getDocs(q);
  const deletions = qs.docs.map(d => deleteDoc(d.ref));
  await Promise.allSettled(deletions);
}

export async function deletePost(postId, mediaUrlsOrUrl, authorSessionId) {
  // Delete Firestore doc
  await deleteDoc(doc(db, "posts", postId));
  // Normalize to array
  const mediaUrls = Array.isArray(mediaUrlsOrUrl)
    ? mediaUrlsOrUrl
    : (typeof mediaUrlsOrUrl === "string" && mediaUrlsOrUrl ? [mediaUrlsOrUrl] : []);
  if (!authorSessionId) return; // cannot safely delete without session ownership
  // Delete each owned media file in Storage
  for (const mediaUrl of mediaUrls) {
    try {
      if (!mediaUrl) continue;
      if (!(mediaUrl.includes("firebase") && mediaUrl.includes("uploads/" + authorSessionId))) continue;
      const storage = getStorage();
      const base = mediaUrl.split("/o/")[1];
      if (!base) continue;
      const path = decodeURIComponent(base.split("?")[0]);
      const fileRef = storageRef(storage, path);
      await deleteObject(fileRef);
    } catch (e) { /* ignore storage delete error per-file */ }
  }
}

export function subscribeComments(postId, callback) {
  const ref = collection(db, `posts/${postId}/comments`);
  // Prime UI with a one-time read to ensure existing comments render on load
  getDocs(ref).then((snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return ta - tb;
    });
    callback(items);
  }).catch(() => {});
  // Live updates thereafter
  return onSnapshot(ref, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return ta - tb;
    });
    callback(items);
  });
}

export async function getPostLikeRepostCounts(postId) {
  // Call server function (avoids client read permission issues)
  const callable = httpsCallable(functions, "getPostCounts");
  const res = await callable({ postId });
  return res.data || { likeCount: 0, repostCount: 0 };
}

export function subscribeToPostsForVariant(variant, callback) {
  const col = collection(db, "posts");
  // 1. Grab static posts once
  let staticPosts = [];
  fetch("./data/posts.json").then(async res => {
    staticPosts = (await res.json()).map(p => ({ ...p, __static: true, createdAt: { toMillis() { return 0; } } }));
    // after static load, first run with whatever user posts loaded
  });
  // 2. Live update Firestore posts and merge with static
  return onSnapshot(col, snap => {
    let fb = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allowed = (p) => {
      if (variant === "pro") return p.stance === "pro" || p.stance === "mixed";
      if (variant === "against") return p.stance === "against" || p.stance === "mixed";
      return p.stance === "pro" || p.stance === "against" || p.stance === "mixed";
    };
    const posts = [...fb.filter(allowed), ...staticPosts.filter(allowed)];
    posts.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    callback(posts);
  });
}


