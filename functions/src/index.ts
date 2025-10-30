import { onCall, CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { VertexAI } from "@google-cloud/vertexai";

initializeApp();
const db = getFirestore();

// Use Vertex AI with Application Default Credentials (ADC)
// Ensure the Vertex AI API is enabled and billing is active in your GCP project
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID;
const LOCATION = process.env.VERTEX_LOCATION || "us-east1";
const vertex = new VertexAI({ project: PROJECT_ID, location: LOCATION });

export const generateComments = onCall(async (request: CallableRequest<any>) => {
  const { data, auth } = request;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Auth required");
  }
  const postId: string = data?.postId;
  const count: number = Math.min(5, Math.max(1, Number(data?.count || 3)));
  if (!postId) throw new HttpsError("invalid-argument", "postId required");

  // Basic rate-limit: one generation per session per post per minute
  const rateKey = `rate_${auth.uid}_${postId}`;
  const rateDoc = db.collection("_rate").doc(rateKey);
  const rateSnap = await rateDoc.get();
  const now = Date.now();
  if (rateSnap.exists) {
    const last = rateSnap.get("ts") as number;
    if (last && now - last < 60_000) {
      return { status: "skipped", reason: "rate_limited" };
    }
  }
  await rateDoc.set({ ts: now }, { merge: true });

  const postRef = db.collection("posts").doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    // For early stages when posts are static JSON on the client, still allow generation using client-provided context
    // but we avoid trusting client data. We simply craft a neutral prompt.
  }

  // Use an explicit version to avoid alias-access issues
  const model = vertex.getGenerativeModel({ model: "gemini-1.5-flash-001" });
  const stance = postSnap.exists ? (postSnap.get("stance") as string) : "mixed";
  const text = postSnap.exists ? (postSnap.get("text") as string) : "";

  const prompt = `You are generating short, natural, social-media style replies to a post.\n` +
    `Post stance: ${stance}.\n` +
    `Post text: ${text}.\n` +
    `Write ${count} distinct replies. Each reply must be a single line under 180 characters, no numbering, no quotes, diverse tone (informational, skeptical, supportive). Avoid offensive language.`;

  const result = await model.generateContent({
    contents: [
      { role: "user", parts: [{ text: prompt }] }
    ]
  });
  const raw = result.response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("\n") || "";
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, count);

  const batch = db.batch();
  const commentsColl = db.collection("posts").doc(postId).collection("comments");
  const outIds: string[] = [];
  for (const line of lines) {
    const ref = commentsColl.doc();
    batch.set(ref, { text: line, source: "gemini", createdAt: FieldValue.serverTimestamp(), sessionId: auth.uid });
    outIds.push(ref.id);
  }
  await batch.commit();
  return { status: "ok", ids: outIds };
});

export const getPostCounts = onCall(async (request: CallableRequest<any>) => {
  const { data, auth } = request;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Auth required");
  }
  const postId: string = data?.postId;
  if (!postId) throw new HttpsError("invalid-argument", "postId required");

  // Query across all sessions' interactions for this postId
  const snap = await db.collectionGroup("interactions").get();
  let likeCount = 0;
  let repostCount = 0;
  snap.forEach(doc => {
    if (doc.id === postId) {
      const d = doc.data() as any;
      if (d.liked) likeCount++;
      if (d.reposted) repostCount++;
    }
  });
  return { likeCount, repostCount };
});


