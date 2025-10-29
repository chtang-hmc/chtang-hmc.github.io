// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";git add .gitignore .
git commit -m "Add project-level .gitignore for Firebase/Functions"
git push
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyA9XprCjXcBfwWpkfr6a3utIwwClX8H_dc",
    authDomain: "spiritofdemocracy-5f1b4.firebaseapp.com",
    projectId: "spiritofdemocracy-5f1b4",
    storageBucket: "spiritofdemocracy-5f1b4.firebasestorage.app",
    messagingSenderId: "723775992949",
    appId: "1:723775992949:web:0057e1081653ede700343c",
    measurementId: "G-EKRPZ9914K"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
const analytics = getAnalytics(app);

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

