import { auth, db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

export async function loadPostsForVariant(variant) {
  // For low traffic and simplicity, load from bundled JSON and filter.
  const res = await fetch("./data/posts.json");
  const all = await res.json();
  return all.filter(p => p.stance === variant || variant === "mixed" && (p.stance === "pro" || p.stance === "against"));
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

export async function createPost({text, mediaType, mediaUrl, author, stance}) {
  const coll = collection(db, "posts");
  return addDoc(coll, {
    text, mediaType, mediaUrl: mediaUrl || "", author,
    stance,
    createdAt: serverTimestamp(),
  });
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


