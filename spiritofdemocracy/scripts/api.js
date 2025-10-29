import { auth, db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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
  return qs.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function generateComments(postId, count = 3) {
  const callable = httpsCallable(functions, "generateComments");
  const result = await callable({ postId, count });
  return result.data;
}


