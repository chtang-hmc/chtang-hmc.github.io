import { submitPoll } from "./api.js";
import { auth } from "./firebase.js";

let endAt = 0;
let intervalId = null;
let endCallbacks = [];

export function startTimer(ms) {
  endAt = Date.now() + ms;
  tick();
  intervalId = setInterval(tick, 250);
  const form = document.getElementById("poll-form");
  if (form) {
    form.addEventListener("submit", onSubmitPoll);
  }
}

export function onTimerEnd(cb) { endCallbacks.push(cb); }

function tick() {
  const now = Date.now();
  const remain = Math.max(0, endAt - now);
  const mm = String(Math.floor(remain / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, "0");
  const label = document.getElementById("countdown");
  if (label) label.textContent = `${mm}:${ss}`;
  if (remain <= 0) {
    clearInterval(intervalId);
    intervalId = null;
    endCallbacks.forEach((f) => f());
    endCallbacks = [];
  }
}

async function onSubmitPoll(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const answer = fd.get("answer");
  const variant = localStorage.getItem("sod_variant") || "mixed";
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await submitPoll(uid, variant, answer);
  const modal = document.getElementById("poll-modal");
  modal.classList.add("hidden");
  disableInteractions();
  // Redirect to thank you page
  setTimeout(() => {
    window.location.href = "./thanks.html";
  }, 300);
}

function disableInteractions() {
  document.querySelectorAll(".btn").forEach(btn => btn.setAttribute("disabled", "true"));
}


