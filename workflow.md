The goal of the project is to make a website that mimicks Twitter/X, hosted at chtang-hmc.github.io/spiritofdemocracy.

Here is the gist of the project: we are aiming to build a social media website for our political science class about dictatorship. The theme of our project is to explore how modern dictators use social media to spread information about convince the public of their ideals.

Here are the details of our project: Our project is concerned with a single political topic, in this case, should artefacts obtained during imperial British period through questionable means should be returned to their original countries. We purposedly chose a topic that people probably don't have an opinion in already, and probably don't have a lot of information about.

We want to present three possible scenarios to our audiences. The first page displays media PRO the return of the artefacts; the second page displays media AGAINST the return of the artefacts; the third page is a mix of both. All pages contain unrelated media to simulate a real social media experience. When audiences visit the website, they are randomly assigned to one of these pages.

The media could be text, image, gif, or video (either the video or a Youtube link). We would like to be able to display all of these media. The structure of a post should be analogous to that of Twitter/X. Users should be able to like/comment/repost. We will provide the media for you, stored in a folder called media. You can tell us what the most optimal way to store the data is for the website to operate most easily. I will also provide you with a Gemini key so that you can generate comments based on the content of the post.

There should be an internal 3 minute timer on the website since that's the time we can allot to each audience. At the end of the 3 minutes, we ask the audiences a question about whether the artefacts should be returned or not. The question would be: Do you think items at the British Museum obtained during the colonial period should be returned to their original countries? The possible answers would be: 'yes', 'no', and 'maybe'. Store the results in the backend. We will need that later.

## Updated Implementation Plan (Finalized for Production)

### Architecture

- Frontend: Static site on GitHub Pages at `chtang-hmc.github.io/spiritofdemocracy` (vanilla JS + CDN Firebase v9 modular).
- Backend: Firebase (Anonymous Auth, Firestore), Cloud Functions (Vertex AI Gemini via service account).
- Data sources: Posts from `spiritofdemocracy/data/posts.json`; interactions/comments/polls in Firestore.

### Frontend Structure

- `spiritofdemocracy/index.html`: App shell, header, timer, poll modal.
- `spiritofdemocracy/styles.css`: Twitter/X-like styling and accessible states.
- `spiritofdemocracy/scripts/`:
  - `firebase.js`: Initialize Firebase. In localhost, connects to emulators for Auth/Firestore; Functions uses prod for Gemini.
  - `router.js`: Random variant assignment (`pro|against|mixed`) + hash routing.
  - `api.js`: Firestore reads/writes; callable `generateComments`; real-time comment subscription.
  - `feed.js`: Render posts, media, like/repost UI with immediate highlight, comments (optimistic + live), AI generation.
  - `timer.js`: 3-minute countdown (30s on localhost), poll modal submission, redirect to `thanks.html`.
- `spiritofdemocracy/thanks.html`: Post-poll confirmation page.
- `spiritofdemocracy/data/posts.json`: Seed posts for all variants.

### Firestore Data Model

- `posts/{postId}`: Public content (seeded via JSON on client, optional Firestore mirror).
- `posts/{postId}/comments/{commentId}`: `{ text, source: 'user'|'gemini', sessionId, createdAt }`.
- `sessions/{sessionId}`: `{ variant, startedAt, assignedAt, userAgent }`.
- `sessions/{sessionId}/interactions/{postId}`: `{ liked, reposted, updatedAt }`.
- `polls/{autoId}`: `{ ownerUid, variant, answer, submittedAt }`.

### Security Rules (essentials)

- Public reads for `posts` and `comments`.
- Auth required for writes.
- `comments`: client can create only with `source=='user'` and matching `sessionId`; AI comments come from Functions (Admin bypass).
- `sessions` and `interactions`: only the owner session can read/write.
- `polls`: create-only with `ownerUid == request.auth.uid`; no read/update/delete.

### Cloud Function (Vertex AI Gemini)

- Callable: `generateComments` (us-central1).
- Uses Vertex AI (`@google-cloud/vertexai`) with ADC in Functions; no API key exposed.
- Rate limits per user+post (basic) and writes N short replies to `posts/{postId}/comments` as `source='gemini'`.

### Local Development

- Emulators: `auth:9099`, `firestore:8080`, `functions:5001`.
- Start: `npx firebase-tools emulators:start --only auth,firestore,functions`.
- Static server: `python3 -m http.server 8085` in `spiritofdemocracy/`.
- Frontend auto-connects to emulators on localhost; Functions uses prod for Gemini by default.

### Deployment

- Frontend: Push to `main` → GitHub Pages serves latest.
- Functions/Rules: `npx firebase-tools deploy --only functions,firestore:rules`.
- Vertex AI: Ensure API enabled, billing on, Functions service account has `Vertex AI User` role.

### UX Details

- Variant label shows assigned feed; persists via `localStorage`.
- Likes/Reposts: highlight immediately; restored on refresh from Firestore interactions for current anonymous user; scoped also in `sessionStorage` for instant UI.
- Comments: optimistic append + live subscription; load existing on page render.
- Timer: 3 minutes in production; modal submits to `polls` and redirects to `thanks.html`.

### Production Hardening

- Restrict Firebase web API key to approved referrers (GitHub Pages domain and localhost).
- Optionally enable App Check (reCAPTCHA v3/Turnstile) for Firestore and Functions.
- Keep Gemini access only via Functions; never expose secrets in client.

### Known/Tracked Items

- Comment initialization on some networks can lag; we now fetch existing comments before subscribing and simplify the listener to avoid metadata-only updates.
- Content seeding: add initial comments in prod if you want pre-existing discussion visible at first load.

### Test Checklist

- Comments visible on page load; new comments persist and appear instantly.
- Likes/Reposts: immediate highlight; persist across refresh.
- AI comments generate; written as `source='gemini'`.
- Poll submission stores `polls/{autoId}` and redirects to thank-you page.
