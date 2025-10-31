import { submitPoll } from "./api.js";
import { auth } from "./firebase.js";

// Timer enabled flag in localStorage
export function isTimerEnabled() {
  // Default to true unless explicitly disabled
  const v = window.localStorage.getItem("sod_timer_enabled");
  if (v == null) return true;
  return v !== "false";
}

// Wire up settings modal
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const toggleTimer = document.getElementById("toggle-timer");
if (settingsBtn) settingsBtn.onclick = () => {
  if (settingsModal) settingsModal.classList.remove("hidden");
  // Set checkbox state from localStorage
  if (toggleTimer) toggleTimer.checked = isTimerEnabled();
};
if (settingsClose) settingsClose.onclick = () => { if (settingsModal) settingsModal.classList.add("hidden"); };
if (toggleTimer) toggleTimer.onchange = (e) => {
  window.localStorage.setItem("sod_timer_enabled", toggleTimer.checked ? "true" : "false");
  // force UI reflect
  if (!toggleTimer.checked) {
    const cd = document.getElementById("countdown");
    if (cd) cd.style.display = "none";
  } else {
    const cd = document.getElementById("countdown");
    if (cd) cd.style.display = "";
  }
};

let endAt = 0;
let intervalId = null;
let endCallbacks = [];

export function startTimer(ms) {
  if (!isTimerEnabled()) {
    // Hide countdown
    const cd = document.getElementById("countdown");
    if (cd) cd.style.display = "none";
    return;
  }
  const cd = document.getElementById("countdown");
  if (cd) cd.style.display = "";
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
  if (!isTimerEnabled()) return;
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
  if (!isTimerEnabled()) return;
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const answer = fd.get("answer");
  const variant = localStorage.getItem("sod_variant") || "mixed";
  const sess = await import("./firebase.js").then(m => m.ensureAnonymousSession(() => variant));
  await import("./api.js").then(m => m.submitPoll(sess.sessionId, variant, answer));
  const modal = document.getElementById("poll-modal");
  modal.classList.add("hidden");
  disableInteractions();
  setTimeout(() => { window.location.href = "./thanks.html"; }, 60);
}

function disableInteractions() {
  document.querySelectorAll(".btn").forEach(btn => btn.setAttribute("disabled", "true"));
}


