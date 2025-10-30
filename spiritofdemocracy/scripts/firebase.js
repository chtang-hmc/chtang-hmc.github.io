// Import the functions you need from the SDKs you need (CDN ESM)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyA9XprCjXcBfwWpkfr6a3utIwwClX8H_dc",
    authDomain: "spiritofdemocracy-5f1b4.firebaseapp.com",
    projectId: "spiritofdemocracy-5f1b4",
    storageBucket: "spiritofdemocracy-5f1b4.appspot.com",
    messagingSenderId: "723775992949",
    appId: "1:723775992949:web:0057e1081653ede700343c",
    measurementId: "G-EKRPZ9914K"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Connect to local emulators when running on localhost
if (location.hostname === "localhost") {
  try {
    connectAuthEmulator(auth, "http://localhost:9099");
    connectFirestoreEmulator(db, "localhost", 8080);
    // For Vertex AI-backed callable, prefer deployed Functions in dev
    // connectFunctionsEmulator(functions, "localhost", 5001);
    // console.log("Connected to Firebase emulators (auth:9099, firestore:8080)");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Failed to connect to emulators:", e);
  }
}

export async function ensureAnonymousSession(variantResolver) {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          await signInAnonymously(auth);
          return; // onAuthStateChanged will fire again
        }
        const sessionId = user.uid;
        let variant = localStorage.getItem("sod_variant");
        if (!variant) {
          variant = variantResolver();
          localStorage.setItem("sod_variant", variant);
        }
        const sessRef = doc(db, "sessions", sessionId);
        await setDoc(sessRef, {
          variant,
          assignedAt: serverTimestamp(),
          startedAt: serverTimestamp(),
          userAgent: navigator.userAgent
        }, { merge: true });
        resolve({ sessionId, variant });
      } catch (e) {
        reject(e);
      }
    });
  });
}

