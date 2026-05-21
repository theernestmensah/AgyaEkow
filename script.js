const TRIBUTE_KEY = "ekowMensahTributes_v6";
const VIDEO_TRIBUTE_KEY = "ekowMensahVideoTributes_v2";
const PHOTO_KEY = "ekowMensahPhotos_v2";
const CANDLE_LIT_KEY = "ekowMensahCandleLit_v5";
const LOCAL_CANDLE_COUNT_KEY = "ekowMensahLocalCandleCount_v1";
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const sampleTributes = [];

const galleryData = [];

const state = {
  firebaseOnline: false,
  tributes: sampleTributes,
  videoTributes: [],
  photos: [],
  candles: 0
};

const tributeForm = document.getElementById("tributeForm");
const tributeWall = document.getElementById("tributeWall");
const formNote = document.getElementById("formNote");
const videoTributeForm = document.getElementById("videoTributeForm");
const videoTributeWall = document.getElementById("videoTributeWall");
const videoFormNote = document.getElementById("videoFormNote");
const photoForm = document.getElementById("photoForm");
const photoFormNote = document.getElementById("photoFormNote");
const lightCandle = document.getElementById("lightCandle");
const candleCount = document.getElementById("candleCount");
const photoUpload = document.getElementById("photoUpload");
const galleryGrid = document.getElementById("galleryGrid");
const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
const candleScene = document.getElementById("candleScene");
const candleHeading = document.getElementById("candleHeading");
const candleSubtext = document.getElementById("candleSubtext");
const cursorDot = document.getElementById("cursorDot");
const cursorRing = document.getElementById("cursorRing");
const bgCanvas = document.getElementById("bgCanvas");
const liveStatus = document.getElementById("liveStatus");

function setLiveStatus(online) {
  state.firebaseOnline = online;
  if (!liveStatus) return;
  liveStatus.textContent = online ? "Live memorial" : "Private preview";
  liveStatus.classList.toggle("is-online", online);
}

function withTimeout(promise, ms = 4500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Connection timed out.")), ms);
    })
  ]);
}

function readLocalTributes() {
  try {
    const raw = localStorage.getItem(TRIBUTE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  localStorage.setItem(TRIBUTE_KEY, JSON.stringify([]));
  return [];
}

function saveLocalTributes(list) {
  localStorage.setItem(TRIBUTE_KEY, JSON.stringify(list));
}

function readLocalVideoTributes() {
  try {
    const raw = localStorage.getItem(VIDEO_TRIBUTE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  localStorage.setItem(VIDEO_TRIBUTE_KEY, JSON.stringify([]));
  return [];
}

function saveLocalVideoTributes(list) {
  localStorage.setItem(VIDEO_TRIBUTE_KEY, JSON.stringify(list));
}

function readLocalPhotos() {
  try {
    const raw = localStorage.getItem(PHOTO_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  localStorage.setItem(PHOTO_KEY, JSON.stringify([]));
  return [];
}

function saveLocalPhotos(list) {
  localStorage.setItem(PHOTO_KEY, JSON.stringify(list));
}

function backendAvailable() {
  return window.location.protocol !== "file:";
}

async function apiFetch(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}



function isCandleLit() {
  return localStorage.getItem(CANDLE_LIT_KEY) === "true";
}

function setCandleLit(value) {
  localStorage.setItem(CANDLE_LIT_KEY, String(value));
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialsFromName(name) {
  return String(name || "EM")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] || "")
    .join("")
    .toUpperCase() || "EM";
}

function renderTributes() {
  if (!tributeWall) return;
  if (!state.tributes.length) {
    tributeWall.innerHTML = `
      <div class="tribute-empty">
        <span class="empty-mark">EM</span>
        <p>No tributes have been posted yet.</p>
        <small>Be the first to leave a memory for the family.</small>
      </div>
    `;
    return;
  }
  tributeWall.innerHTML = state.tributes.map((t, i) => {
    const rel = t.relationship || "Loved one";
    const initials = initialsFromName(t.name);
    return `
      <article class="tribute-card" style="animation-delay: ${i * 0.08}s">
        <div class="tribute-card-top">
          <span class="tribute-initials" aria-hidden="true">${escapeHtml(initials)}</span>
          <span class="tribute-date">${escapeHtml(t.date || "")}</span>
        </div>
        <blockquote>
          <svg class="tribute-quote-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2Z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h.75c0 2.25-.75 3.75-1.75 4Z"/></svg>
          <span>${escapeHtml(t.message)}</span>
        </blockquote>
        <div class="tribute-meta">
          <strong>${escapeHtml(t.name)}</strong>
          <span>${escapeHtml(rel)}</span>
        </div>
      </article>
    `;
  }).join("");
}

async function loadTributes() {
  state.tributes = readLocalTributes();
  renderTributes();

  if (!backendAvailable()) return;

  try {
    const payload = await apiFetch("/api/tributes");
    state.tributes = payload.tributes || [];
    saveLocalTributes(state.tributes);
    setLiveStatus(true);
    renderTributes();
  } catch (_) {
    setLiveStatus(false);
    renderTributes();
  }
}

function renderVideoTributes() {
  if (!videoTributeWall) return;
  if (!state.videoTributes.length) {
    videoTributeWall.innerHTML = `
      <div class="video-empty">
        <span class="empty-mark">REC</span>
        <p>No video tributes have been uploaded yet.</p>
        <small>Recordings will appear here after upload.</small>
      </div>
    `;
    return;
  }

  videoTributeWall.innerHTML = state.videoTributes.map(video => `
    <article class="video-card">
      <video controls preload="metadata" src="${escapeHtml(video.videoUrl)}"></video>
      <div class="video-card-body">
        <strong>${escapeHtml(video.name)}</strong>
        <span>${escapeHtml(video.relationship || "Loved one")} · ${escapeHtml(video.date || "")}</span>
        ${video.message ? `<p>${escapeHtml(video.message)}</p>` : ""}
      </div>
    </article>
  `).join("");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function loadVideoTributes() {
  state.videoTributes = readLocalVideoTributes();
  renderVideoTributes();

  if (!backendAvailable()) return;

  try {
    const payload = await apiFetch("/api/video-tributes");
    state.videoTributes = payload.videoTributes || [];
    saveLocalVideoTributes(state.videoTributes);
    renderVideoTributes();
  } catch (_) {
    renderVideoTributes();
  }
}

function updateCandleCount(count) {
  state.candles = Number(count) || 0;
  if (candleCount) candleCount.textContent = state.candles.toLocaleString();
}

function setCandleButtonLabel(label) {
  if (!lightCandle) return;
  lightCandle.innerHTML = `
    <svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2s5 4.5 5 10a5 5 0 0 1-10 0c0-5.5 5-10 5-10Z"/><path d="M12 13a2 2 0 0 0 2-2c0-1.5-2-4-2-4s-2 2.5-2 4a2 2 0 0 0 2 2Z"/><path d="M9 22h6"/></svg>
    <span>${label}</span>
  `;
}

function applyLitState(lit) {
  if (!lit || !candleScene || !lightCandle) return;
  candleScene.classList.add("is-lit");
  if (candleHeading) candleHeading.textContent = "A flame burns for him";
  if (candleSubtext) candleSubtext.textContent = "Your light joins many others in his memory.";
  setCandleButtonLabel("Candle lit");
  lightCandle.disabled = true;
  lightCandle.classList.add("lit");
}

function renderGallery() {
  if (!galleryGrid) return;
  const approvedPhotos = state.photos.map(photo => `
    <figure class="gallery-item">
      <img src="${escapeHtml(photo.imageUrl)}" alt="${escapeHtml(photo.caption || "Memory photo of Mr. Joseph Ekow Mensah")}">
      <figcaption class="gallery-caption">
        ${photo.caption ? `<strong>${escapeHtml(photo.caption)}</strong>` : ""}
        ${photo.name ? `<span>${escapeHtml(photo.name)}</span>` : ""}
      </figcaption>
    </figure>
  `);

  const placeholders = galleryData.map((g, i) => `
    <figure class="gallery-item">
      <div class="gallery-placeholder">
        <div class="g-num">${String(i + 1).padStart(2, "0")}</div>
        <span class="g-lbl">${g.label}</span>
      </div>
    </figure>
  `);

  galleryGrid.innerHTML = [...approvedPhotos, ...placeholders].join("");
}

async function loadPhotos() {
  state.photos = readLocalPhotos();
  renderGallery();

  if (!backendAvailable()) return;

  try {
    const payload = await apiFetch("/api/photos");
    state.photos = payload.photos || [];
    saveLocalPhotos(state.photos);
    renderGallery();
  } catch (_) {
    renderGallery();
  }
}

async function loadCandles() {
  if (!backendAvailable()) {
    let localCount = localStorage.getItem(LOCAL_CANDLE_COUNT_KEY);
    if (localCount === null) {
      localCount = 8;
      localStorage.setItem(LOCAL_CANDLE_COUNT_KEY, String(localCount));
    } else {
      localCount = Number(localCount) || 8;
    }
    updateCandleCount(localCount);
    return;
  }

  try {
    const payload = await apiFetch("/api/candles");
    if (payload && payload.count !== undefined) {
      updateCandleCount(payload.count);
    }
  } catch (_) {}
}

function sparkCandle() {
  for (let i = 0; i < 30; i += 1) {
    particles.push({
      x: window.innerWidth / 2,
      y: window.innerHeight - 200,
      size: Math.random() * 3 + 1,
      speedY: Math.random() * 5 + 2,
      speedX: (Math.random() - 0.5) * 5,
      opacity: 1,
      oscillationSpeed: 0,
      oscillationOffset: 0
    });
  }
}

tributeForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(tributeForm);
  const name = String(data.get("name") || "").trim();
  const relationship = String(data.get("relationship") || "").trim();
  const message = String(data.get("message") || "").trim();
  const file = data.get("video");

  const hasVideo = file && file instanceof File && file.size > 0;

  if (!name) {
    formNote.textContent = "Please add your name.";
    formNote.style.color = "#e07a5f";
    return;
  }

  if (hasVideo) {
    if (!file.type.startsWith("video/")) {
      formNote.textContent = "Please choose a valid video file.";
      formNote.style.color = "#e07a5f";
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      formNote.textContent = "Please choose a video under 80MB.";
      formNote.style.color = "#e07a5f";
      return;
    }
    if (!backendAvailable()) {
      formNote.textContent = "Video uploads need the backend server running.";
      formNote.style.color = "#e07a5f";
      return;
    }

    formNote.textContent = "Uploading your video tribute...";
    formNote.style.color = "var(--gold-bright)";

    try {
      const videoData = await fileToDataUrl(file);
      await apiFetch("/api/video-tributes", {
        method: "POST",
        body: JSON.stringify({
          name,
          relationship,
          message,
          fileName: file.name,
          videoData
        })
      });

      tributeForm.reset();
      formNote.textContent = "Thank you. Your video tribute has been submitted for review.";
      formNote.style.color = "var(--gold-bright)";
    } catch (error) {
      formNote.textContent = error.message || "We could not upload that video.";
      formNote.style.color = "#e07a5f";
    }
  } else {
    if (!message) {
      formNote.textContent = "Please add a tribute message.";
      formNote.style.color = "#e07a5f";
      return;
    }

    formNote.textContent = "Submitting your tribute for review...";
    formNote.style.color = "var(--gold-bright)";

    try {
      if (backendAvailable()) {
        await apiFetch("/api/tributes", {
          method: "POST",
          body: JSON.stringify({ name, relationship, message })
        });
      } else {
        const tribute = {
          name,
          relationship,
          message,
          status: "pending",
          date: new Date().toLocaleDateString("en", { month: "short", year: "numeric" })
        };
        saveLocalTributes([tribute, ...readLocalTributes()]);
      }

      tributeForm.reset();
      formNote.textContent = "Thank you. Your tribute has been submitted for review.";
      formNote.style.color = "var(--gold-bright)";
    } catch (error) {
      formNote.textContent = error.message || "We could not post that tribute just now.";
      formNote.style.color = "#e07a5f";
    }
  }
});

photoForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(photoForm);
  const name = String(data.get("name") || "").trim();
  const caption = String(data.get("caption") || "").trim();
  const file = data.get("photo");

  if (!(file instanceof File) || !file.size) {
    photoFormNote.textContent = "Please choose a photo.";
    photoFormNote.style.color = "#e07a5f";
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    photoFormNote.textContent = "Please choose a JPG, PNG, or WebP photo.";
    photoFormNote.style.color = "#e07a5f";
    return;
  }

  if (file.size > MAX_PHOTO_BYTES) {
    photoFormNote.textContent = "Please choose a photo under 8MB.";
    photoFormNote.style.color = "#e07a5f";
    return;
  }

  if (!backendAvailable()) {
    photoFormNote.textContent = "Photo submissions need the backend server running.";
    photoFormNote.style.color = "#e07a5f";
    return;
  }

  photoFormNote.textContent = "Submitting your photo for review...";
  photoFormNote.style.color = "var(--gold-bright)";

  try {
    const photoData = await fileToDataUrl(file);
    await apiFetch("/api/photos", {
      method: "POST",
      body: JSON.stringify({
        name,
        caption,
        fileName: file.name,
        photoData
      })
    });
    photoForm.reset();
    photoFormNote.textContent = "Thank you. Your photo has been submitted for review.";
    photoFormNote.style.color = "var(--gold-bright)";
  } catch (error) {
    photoFormNote.textContent = error.message || "We could not submit that photo.";
    photoFormNote.style.color = "#e07a5f";
  }
});

lightCandle?.addEventListener("click", async () => {
  if (isCandleLit()) return;
  if (!backendAvailable()) {
    let localCount = localStorage.getItem(LOCAL_CANDLE_COUNT_KEY);
    if (localCount === null) {
      localCount = 8;
    } else {
      localCount = Number(localCount) || 8;
    }
    localCount += 1;
    localStorage.setItem(LOCAL_CANDLE_COUNT_KEY, String(localCount));
    updateCandleCount(localCount);
    setCandleLit(true);
    applyLitState(true);
    sparkCandle();
    return;
  }

  try {
    const payload = await apiFetch("/api/candles", { method: "POST" });
    updateCandleCount(payload.count);
    setCandleLit(true);
    applyLitState(true);
    sparkCandle();
  } catch (error) {
    console.error("Failed to light candle on server:", error);
  }
});

navToggle?.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});

navLinks?.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
    document.querySelector(".nav-dropdown-wrapper")?.classList.remove("open");
    document.querySelector(".nav-dropdown-toggle")?.setAttribute("aria-expanded", "false");
  });
});

// Dropdown toggle logic
const dropdownToggle = document.querySelector(".nav-dropdown-toggle");
const dropdownWrapper = document.querySelector(".nav-dropdown-wrapper");

if (dropdownToggle && dropdownWrapper) {
  dropdownToggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = dropdownWrapper.classList.toggle("open");
    dropdownToggle.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!dropdownWrapper.contains(e.target)) {
      dropdownWrapper.classList.remove("open");
      dropdownToggle.setAttribute("aria-expanded", "false");
    }
  });
}

const nav = document.querySelector(".site-nav");
window.addEventListener("scroll", () => {
  if (window.scrollY > 50) nav?.classList.add("scrolled");
  else nav?.classList.remove("scrolled");
}, { passive: true });

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let ringX = mouseX;
let ringY = mouseY;

window.addEventListener("mousemove", event => {
  mouseX = event.clientX;
  mouseY = event.clientY;
  if (cursorDot) cursorDot.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
});

function animateCursor() {
  ringX += (mouseX - ringX) * 0.15;
  ringY += (mouseY - ringY) * 0.15;
  if (cursorRing) cursorRing.style.transform = `translate(${ringX}px, ${ringY}px)`;
  requestAnimationFrame(animateCursor);
}
animateCursor();

document.querySelectorAll("a, button, input, textarea, label").forEach(el => {
  el.addEventListener("mouseenter", () => {
    cursorRing?.classList.add("hovered");
    cursorDot?.classList.add("hovered");
  });
  el.addEventListener("mouseleave", () => {
    cursorRing?.classList.remove("hovered");
    cursorDot?.classList.remove("hovered");
  });
});

if (typeof gsap !== "undefined") {
  document.querySelectorAll(".btn").forEach(btn => {
    btn.addEventListener("mousemove", event => {
      const rect = btn.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      gsap.to(btn, { x: x * 0.3, y: y * 0.3, duration: 0.6, ease: "power3.out" });
    });

    btn.addEventListener("mouseleave", () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.3)" });
    });
  });

  if (document.querySelector(".hero") && document.querySelector(".hero-portrait-col")) {
    gsap.to(".hero-portrait-col", {
      yPercent: 15,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: true
      }
    });
  }

  document.querySelectorAll(".reveal").forEach(el => {
    gsap.fromTo(el, { opacity: 0, y: 50 }, {
      opacity: 1,
      y: 0,
      duration: 1.2,
      ease: "power3.out",
      scrollTrigger: {
        trigger: el,
        start: "top 85%",
        toggleActions: "play none none none"
      }
    });
  });
} else {
  document.querySelectorAll(".reveal").forEach(el => el.classList.add("visible"));
}

const ctx = bgCanvas?.getContext("2d");
let particles = [];
let width = window.innerWidth;
let height = window.innerHeight;

function initCanvas() {
  if (!bgCanvas || !ctx) return;
  width = window.innerWidth;
  height = window.innerHeight;
  bgCanvas.width = width;
  bgCanvas.height = height;
  particles = [];
  const numParticles = window.innerWidth < 768 ? 30 : 70;

  for (let i = 0; i < numParticles; i += 1) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      speedY: Math.random() * 0.5 + 0.1,
      speedX: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.5 + 0.1,
      oscillationSpeed: Math.random() * 0.02 + 0.01,
      oscillationOffset: Math.random() * Math.PI * 2
    });
  }
}

function animateCanvas() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const time = Date.now();

  particles.forEach(particle => {
    particle.y -= particle.speedY;
    particle.x += Math.sin(time * particle.oscillationSpeed + particle.oscillationOffset) * 0.5 + particle.speedX;

    if (particle.y < -10) {
      particle.y = height + 10;
      particle.x = Math.random() * width;
    }
    if (particle.x < -10) particle.x = width + 10;
    if (particle.x > width + 10) particle.x = -10;

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(226, 175, 101, ${particle.opacity})`;
    ctx.fill();
  });

  requestAnimationFrame(animateCanvas);
}

window.addEventListener("resize", initCanvas);
initCanvas();
animateCanvas();

state.photos = readLocalPhotos();
loadTributes();
loadPhotos();
loadVideoTributes();
loadCandles();
setLiveStatus(false);
if (isCandleLit()) applyLitState(true);
