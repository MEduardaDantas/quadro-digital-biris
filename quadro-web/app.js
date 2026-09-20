/* ==========================================================================
   CONFIG
   ========================================================================== */

const API_BASE_URL = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("api")) return params.get("api");

  // 1) config.js explícito (site e backend em domínios diferentes,
  //    ex: GitHub Pages + Railway) — ver quadro-web/config.js
  if (window.QUADRO_API_BASE_URL) return window.QUADRO_API_BASE_URL;

  // 2) desenvolvimento local (server.py na porta 8080, backend solto na
  //    3000) — cai pro backend local só nesse caso específico
  const isLocalDev = window.location.hostname === "localhost" && window.location.port === "8080";
  if (isLocalDev) return "http://localhost:3000";

  // 3) produção com tudo atrás do mesmo domínio (Nginx reverse proxy)
  return window.location.origin;
})();

const MAX_PHOTOS = 8;

/* ==========================================================================
   API
   ========================================================================== */

const API = (() => {
  function authHeaders(sessionToken) {
    return { Authorization: `Bearer ${sessionToken}` };
  }
  async function safeJson(res) {
    try { return await res.json(); } catch { return {}; }
  }

  return {
    async lookupFrame(frameToken) {
      try {
        const res = await fetch(`${API_BASE_URL}/q/${encodeURIComponent(frameToken)}`);
        if (!res.ok) return { exists: false };
        const data = await safeJson(res);
        return { exists: !!data.exists, frame_id: data.frame_id };
      } catch (err) {
        console.error("lookupFrame falhou:", err);
        return { exists: false, networkError: true };
      }
    },

    async login(frameToken, password) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame_token: frameToken, password }),
        });
        const data = await safeJson(res);
        if (!res.ok) return { ok: false, error: data.error || "login_failed" };
        return { ok: true, session_token: data.session_token };
      } catch (err) {
        console.error("login falhou:", err);
        return { ok: false, error: "network_error" };
      }
    },

    async logout(sessionToken) {
      try {
        await fetch(`${API_BASE_URL}/api/v1/auth/logout`, { method: "POST", headers: authHeaders(sessionToken) });
      } catch (err) {
        console.error("logout falhou (ignorando):", err);
      }
      return { ok: true };
    },

    async getCurrentState(sessionToken) {
      let res;
      try {
        res = await fetch(`${API_BASE_URL}/api/v1/frame/current`, { headers: authHeaders(sessionToken) });
      } catch (err) {
        console.error("getCurrentState falhou:", err);
        return { ok: false, error: "network_error" };
      }
      const data = await safeJson(res);
      if (!res.ok) return { ok: false, error: data.error || "get_state_failed" };

      const photos = [];
      for (const p of data.photos) {
        try {
          const imgRes = await fetch(`${API_BASE_URL}${p.url}`, { headers: authHeaders(sessionToken) });
          const blob = await imgRes.blob();
          photos.push({ id: p.id, fit: p.fit, crop: p.crop || { x: 50, y: 50, zoom: 1 }, dataUrl: URL.createObjectURL(blob) });
        } catch (err) {
          console.error(`falha ao baixar foto ${p.id}:`, err);
        }
      }
      return { ok: true, frame_id: data.frame_id, version: data.version, orientation: data.orientation, layoutTemplate: data.layout_template, photos };
    },

    async getStatus(sessionToken) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/frame/status`, { headers: authHeaders(sessionToken) });
        if (!res.ok) return null;
        return await safeJson(res);
      } catch (err) {
        console.error("getStatus falhou:", err);
        return null;
      }
    },

    async getAlbum(sessionToken) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/frame/album`, { headers: authHeaders(sessionToken) });
        if (!res.ok) return { photos: [], count: 0, limit: 50 };
        const data = await safeJson(res);
        const photos = [];
        for (const p of data.photos) {
          try {
            const imgRes = await fetch(`${API_BASE_URL}${p.url}`, { headers: authHeaders(sessionToken) });
            const blob = await imgRes.blob();
            photos.push({ id: p.id, sourcePhotoId: p.source_photo_id, dataUrl: URL.createObjectURL(blob) });
          } catch (err) {
            console.error("falha ao baixar foto do álbum:", err);
          }
        }
        return { photos, count: data.count, limit: data.limit };
      } catch (err) {
        console.error("getAlbum falhou:", err);
        return { photos: [], count: 0, limit: 50 };
      }
    },

    // Busca um blob NOVO e independente de uma foto do álbum — usado ao
    // escolher uma foto do álbum pra composição, pra não depender do
    // ciclo de vida dos blobs da listagem do álbum (que são revogados
    // toda vez que o álbum recarrega).
    async getAlbumPhotoBlobUrl(sessionToken, albumId) {
      const res = await fetch(`${API_BASE_URL}/api/v1/frame/album/${albumId}/photo`, { headers: authHeaders(sessionToken) });
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },

    async likePhoto(sessionToken, photoId) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/frame/current/photos/${photoId}/like`, {
          method: "POST", headers: authHeaders(sessionToken),
        });
        const data = await safeJson(res);
        if (!res.ok) return { ok: false, error: data.error };
        return { ok: true, album_id: data.album_id };
      } catch (err) {
        console.error("likePhoto falhou:", err);
        return { ok: false, error: "network_error" };
      }
    },

    async unlikePhoto(sessionToken, albumId) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/frame/album/${albumId}`, {
          method: "DELETE", headers: authHeaders(sessionToken),
        });
        return { ok: res.ok };
      } catch (err) {
        console.error("unlikePhoto falhou:", err);
        return { ok: false };
      }
    },

    async getSettings(sessionToken) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/frame/settings`, { headers: authHeaders(sessionToken) });
        if (!res.ok) return null;
        return await safeJson(res);
      } catch (err) {
        console.error("getSettings falhou:", err);
        return null;
      }
    },

    async updateSettings(sessionToken, { deviceName, frameStyle }) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/frame/settings`, {
          method: "PUT",
          headers: { ...authHeaders(sessionToken), "Content-Type": "application/json" },
          body: JSON.stringify({ device_name: deviceName, settings: { frame_style: frameStyle } }),
        });
        return { ok: res.ok };
      } catch (err) {
        console.error("updateSettings falhou:", err);
        return { ok: false };
      }
    },

    async publish(sessionToken, draft) {
      const form = new FormData();
      const manifestPhotos = [];
      draft.photos.forEach((p, i) => {
        if (p.sourceId) {
          manifestPhotos.push({ action: "keep", id: p.sourceId, fit: p.fit, crop: p.crop });
        } else if (p.fromAlbumId) {
          manifestPhotos.push({ action: "from_album", album_id: p.fromAlbumId, fit: p.fit, crop: p.crop });
        } else {
          const tempKey = `p${i}`;
          manifestPhotos.push({ action: "new", temp_key: tempKey, fit: p.fit, crop: p.crop });
          form.append(`photo_${tempKey}`, p.file);
        }
      });
      form.append("manifest", JSON.stringify({
        base_version: draft.base_version,
        orientation: draft.orientation,
        layout_template: draft.layoutTemplate,
        photos: manifestPhotos,
      }));

      let res;
      try {
        res = await fetch(`${API_BASE_URL}/api/v1/frame/publications`, {
          method: "POST", headers: authHeaders(sessionToken), body: form,
        });
      } catch (err) {
        console.error("publish falhou:", err);
        return { ok: false, error: "network_error" };
      }
      const data = await safeJson(res);
      if (!res.ok) return { ok: false, error: data.error || "publish_failed" };
      return { ok: true, status: data.status, version: data.version };
    },
  };
})();

/* ==========================================================================
   ROTEAMENTO
   ========================================================================== */

function getFrameTokenFromUrl() {
  const path = window.location.pathname;
  const match = path.match(/\/q\/([^/]+)/);
  if (match) return decodeURIComponent(match[1]);
  const params = new URLSearchParams(window.location.search);
  if (params.get("frame")) return params.get("frame");
  return null;
}

/* ==========================================================================
   ESTADO
   ========================================================================== */

const state = {
  frameToken: null,
  sessionToken: null,
  publishedVersion: null,
  publishedOrientation: "landscape",
  publishedLayoutTemplate: "uniform",
  publishedPhotos: [],
  draftOrientation: "landscape",
  draftLayoutTemplate: "uniform",
  draftPhotos: [],
  frameStyle: "classica",
  statusPollTimer: null,
  album: [],
  albumLimit: 50,
  dragSrcIndex: null,
  lightboxAlbumId: null,
};

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function defaultCrop() { return { x: 50, y: 50, zoom: 1 }; }
function cropsEqual(a, b) {
  const ca = a || defaultCrop(), cb = b || defaultCrop();
  return ca.x === cb.x && ca.y === cb.y && Math.abs(ca.zoom - cb.zoom) < 0.001;
}

let activeObjectUrls = [];
function trackObjectUrl(url) { if (url && url.startsWith("blob:")) activeObjectUrls.push(url); }
function revokeTrackedObjectUrls() { activeObjectUrls.forEach((u) => URL.revokeObjectURL(u)); activeObjectUrls = []; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`; }

/* ==========================================================================
   VIEWS / NAV
   ========================================================================== */

const views = {
  loading: document.getElementById("view-loading"),
  notFound: document.getElementById("view-not-found"),
  login: document.getElementById("view-login"),
  editor: document.getElementById("view-editor"),
  album: document.getElementById("view-album"),
};
const topNav = document.getElementById("top-nav");

function showView(name) {
  Object.values(views).forEach((el) => (el.hidden = true));
  views[name].hidden = false;
  topNav.hidden = !(name === "editor" || name === "album");
}

function switchPage(page) {
  showView(page);
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.getAttribute("data-page") === page);
  });
}

document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchPage(tab.getAttribute("data-page")));
});

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 3600);
}

/* ==========================================================================
   INICIALIZAÇÃO
   ========================================================================== */

async function init() {
  showView("loading");
  const token = getFrameTokenFromUrl();

  if (!token) {
    setNotFoundMessage("Não encontramos nenhum quadro com este código.", "Verifique se o QR Code foi escaneado corretamente.");
    showView("notFound");
    return;
  }

  const result = await API.lookupFrame(token);
  if (!result.exists) {
    if (result.networkError) {
      setNotFoundMessage("Não conseguimos falar com o servidor agora.", `Verifique se o backend está rodando em ${API_BASE_URL}.`);
    } else {
      setNotFoundMessage("Não encontramos nenhum quadro com este código.", "Verifique se o QR Code foi escaneado corretamente.");
    }
    showView("notFound");
    return;
  }

  state.frameToken = token;
  document.getElementById("login-frame-id").textContent = "Quadro: " + token;
  showView("login");
}

function setNotFoundMessage(title, subtitle) {
  document.getElementById("not-found-title").textContent = title;
  document.getElementById("not-found-subtitle").textContent = subtitle;
}

/* ==========================================================================
   LOGIN / LOGOUT
   ========================================================================== */

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  const password = document.getElementById("login-password").value;
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando…";

  const result = await API.login(state.frameToken, password);

  submitBtn.disabled = false;
  submitBtn.textContent = "Entrar";

  if (!result.ok) {
    errorEl.textContent =
      result.error === "invalid_credentials" ? "Senha incorreta. Tente novamente."
      : result.error === "too_many_attempts" ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
      : "Não foi possível entrar. Tente novamente.";
    errorEl.hidden = false;
    return;
  }

  state.sessionToken = result.session_token;
  await loadEditor();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  stopStatusPolling();
  await API.logout(state.sessionToken);
  revokeTrackedObjectUrls();
  state.album.forEach((p) => URL.revokeObjectURL(p.dataUrl));
  state.sessionToken = null;
  state.draftPhotos = [];
  state.publishedPhotos = [];
  state.album = [];
  document.getElementById("login-password").value = "";
  switchPage("editor");
  showView("login");
});

/* ==========================================================================
   EDITOR — carregamento
   ========================================================================== */

async function loadEditor() {
  showView("loading");
  const result = await API.getCurrentState(state.sessionToken);
  if (!result.ok) {
    showView("login");
    return;
  }

  revokeTrackedObjectUrls();
  result.photos.forEach((p) => trackObjectUrl(p.dataUrl));

  state.publishedVersion = result.version;
  state.publishedOrientation = result.orientation;
  state.publishedLayoutTemplate = result.layoutTemplate || "uniform";
  state.publishedPhotos = result.photos;

  state.draftOrientation = result.orientation;
  state.draftLayoutTemplate = state.publishedLayoutTemplate;
  state.draftPhotos = result.photos.map((p) => ({
    localId: uid(), sourceId: p.id, dataUrl: p.dataUrl, file: null, fit: p.fit, crop: p.crop || defaultCrop(),
  }));

  renderAll();
  switchPage("editor");

  refreshDeviceStatus();
  startStatusPolling();
  loadAlbum();
  loadSettings();
}

function startStatusPolling() {
  stopStatusPolling();
  state.statusPollTimer = setInterval(refreshDeviceStatus, 5000);
}
function stopStatusPolling() {
  if (state.statusPollTimer) clearInterval(state.statusPollTimer);
  state.statusPollTimer = null;
}
async function refreshDeviceStatus() {
  const status = await API.getStatus(state.sessionToken);
  renderDeviceStatus(status);
}

/* ==========================================================================
   RENDER — status
   ========================================================================== */

function hasChanges() {
  if (state.draftOrientation !== state.publishedOrientation) return true;
  if (state.draftLayoutTemplate !== state.publishedLayoutTemplate) return true;
  if (state.draftPhotos.length !== state.publishedPhotos.length) return true;
  return state.draftPhotos.some((p, i) => {
    const pub = state.publishedPhotos[i];
    return !pub || p.sourceId !== pub.id || p.fit !== pub.fit || !cropsEqual(p.crop, pub.crop);
  });
}

function renderDraftPill() {
  const pill = document.getElementById("draft-pill");
  if (hasChanges()) {
    pill.textContent = "Rascunho — alterações não publicadas";
    pill.className = "status-pill is-draft";
  } else {
    pill.textContent = `Publicado — versão ${state.publishedVersion}`;
    pill.className = "status-pill is-published";
  }
}

function renderDeviceStatus(status) {
  const dot = document.getElementById("device-dot");
  const text = document.getElementById("device-pill-text");
  if (!status) { dot.className = "status-dot"; text.textContent = "status indisponível"; return; }

  const labels = { updated: "atualizado", syncing: "sincronizando", outdated: "desatualizado", unknown: "aguardando 1ª sinc." };

  if (!status.online) { dot.className = "status-dot is-offline"; text.textContent = "offline"; }
  else if (status.sync_state === "syncing") { dot.className = "status-dot is-syncing"; text.textContent = "sincronizando"; }
  else { dot.className = "status-dot is-online"; text.textContent = labels[status.sync_state] || status.sync_state; }

  document.getElementById("info-battery").textContent = status.battery_pct != null ? `${status.battery_pct}%` : "N/A";
  document.getElementById("info-storage").textContent =
    status.storage_used_mb != null && status.storage_total_mb != null
      ? `${status.storage_used_mb} MB / ${status.storage_total_mb} MB` : "N/A";
  document.getElementById("info-last-sync").textContent = status.last_seen_at
    ? new Date(status.last_seen_at).toLocaleString("pt-BR") : "N/A";
}

/* ==========================================================================
   ORIENTAÇÃO
   ========================================================================== */

document.querySelectorAll(".orientation-btn").forEach((btn) => {
  btn.addEventListener("click", () => { state.draftOrientation = btn.getAttribute("data-orientation"); renderAll(); });
});
function renderOrientationButtons() {
  document.querySelectorAll(".orientation-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-orientation") === state.draftOrientation);
  });
}

document.querySelectorAll(".layout-btn").forEach((btn) => {
  btn.addEventListener("click", () => { state.draftLayoutTemplate = btn.getAttribute("data-layout"); renderAll(); });
});
function renderLayoutButtons() {
  document.querySelectorAll(".layout-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-layout") === state.draftLayoutTemplate);
  });
}

/* ==========================================================================
   MOCKUP DO QUADRO
   ========================================================================== */

function computePhotoStyle(photo) {
  const crop = photo.crop || defaultCrop();
  if (photo.fit === "cover") {
    return `object-fit:cover;object-position:${crop.x}% ${crop.y}%;transform:scale(${crop.zoom});`;
  }
  return "object-fit:contain;";
}

function buildMockupHtml(photos, interactive) {
  if (photos.length === 0) {
    return `<div class="frame-mockup-empty">
      <svg class="icon" viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9.59l3.3-3.3a1 1 0 0 1 1.4 0L12 14.6l3.3-3.3a1 1 0 0 1 1.4 0L19 13.6V6H5Zm4 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/></svg>
      <span>Nenhuma foto ainda</span>
    </div>`;
  }
  return photos.map((p, i) => {
    if (!p.dataUrl) return `<div class="photo-item" data-index="${i}"></div>`;
    const style = computePhotoStyle(p);
    const zoomControls = interactive && p.fit === "cover" ? `
      <div class="photo-item-zoom-controls">
        <button type="button" class="zoom-btn" data-zoom="out" data-index="${i}" title="Reduzir">−</button>
        <button type="button" class="zoom-btn" data-zoom="reset" data-index="${i}" title="Centralizar">⟳</button>
        <button type="button" class="zoom-btn" data-zoom="in" data-index="${i}" title="Ampliar">+</button>
      </div>` : "";
    return `<div class="photo-item" data-index="${i}" data-fit="${p.fit}">
      <img class="photo-item-img" src="${p.dataUrl}" style="${style}" draggable="false" alt="" />
      ${zoomControls}
    </div>`;
  }).join("");
}

function renderMockup(containerId, orientation, layoutTemplate, photos, interactive) {
  const el = document.getElementById(containerId);
  el.className = `frame-mockup orientation-${orientation} layout-${layoutTemplate} moldura-${state.frameStyle}` +
    (containerId.includes("modal") ? " frame-mockup--modal" : "");
  el.innerHTML = buildMockupHtml(photos, interactive);
  if (interactive) attachPhotoInteractions(containerId);
}

/* ==========================================================================
   INTERAÇÃO NA FOTO — arrastar pra posicionar, roda/botões pra zoom
   ========================================================================== */

function refreshChangeUI() {
  renderDraftPill();
  const changed = hasChanges();
  document.getElementById("btn-preview").disabled = !changed;
  document.getElementById("draft-status").textContent = changed ? "Composição pronta para revisão." : "Nada alterado ainda.";
}

function attachPhotoInteractions(containerId) {
  const container = document.getElementById(containerId);

  container.querySelectorAll('.photo-item[data-fit="cover"]').forEach((item) => {
    const index = Number(item.getAttribute("data-index"));
    const img = item.querySelector(".photo-item-img");
    if (!img) return;

    let dragging = false, startX = 0, startY = 0, startCropX = 50, startCropY = 50;

    img.addEventListener("pointerdown", (e) => {
      const photo = state.draftPhotos[index];
      if (!photo) return;
      dragging = true;
      img.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      const crop = photo.crop || defaultCrop();
      startCropX = crop.x; startCropY = crop.y;
    });

    img.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const photo = state.draftPhotos[index];
      if (!photo) return;
      const rect = item.getBoundingClientRect();
      const dxPct = ((e.clientX - startX) / rect.width) * 100;
      const dyPct = ((e.clientY - startY) / rect.height) * 100;
      const crop = photo.crop || defaultCrop();
      crop.x = clamp(startCropX - dxPct, 0, 100);
      crop.y = clamp(startCropY - dyPct, 0, 100);
      photo.crop = crop;
      img.style.objectPosition = `${crop.x}% ${crop.y}%`;
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      refreshChangeUI();
    }
    img.addEventListener("pointerup", endDrag);
    img.addEventListener("pointercancel", endDrag);

    img.addEventListener("wheel", (e) => {
      e.preventDefault();
      const photo = state.draftPhotos[index];
      if (!photo) return;
      const crop = photo.crop || defaultCrop();
      crop.zoom = clamp(crop.zoom + (e.deltaY < 0 ? 0.1 : -0.1), 1, 3);
      photo.crop = crop;
      img.style.transform = `scale(${crop.zoom})`;
      refreshChangeUI();
    }, { passive: false });
  });

  container.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.getAttribute("data-index"));
      const mode = btn.getAttribute("data-zoom");
      const photo = state.draftPhotos[index];
      if (!photo) return;
      const crop = photo.crop || defaultCrop();
      if (mode === "in") crop.zoom = clamp(crop.zoom + 0.2, 1, 3);
      else if (mode === "out") crop.zoom = clamp(crop.zoom - 0.2, 1, 3);
      else { crop.x = 50; crop.y = 50; crop.zoom = 1; }
      photo.crop = crop;

      const img = btn.closest(".photo-item").querySelector(".photo-item-img");
      img.style.objectPosition = `${crop.x}% ${crop.y}%`;
      img.style.transform = `scale(${crop.zoom})`;
      refreshChangeUI();
    });
  });
}

/* ==========================================================================
   LISTA DE FOTOS (com drag & drop)
   ========================================================================== */

function renderPhotoList() {
  const container = document.getElementById("photo-list");
  container.innerHTML = "";

  state.draftPhotos.forEach((photo, index) => {
    const row = document.createElement("div");
    row.className = "photo-row";
    row.draggable = true;

    row.addEventListener("dragstart", () => { state.dragSrcIndex = index; row.classList.add("is-dragging"); });
    row.addEventListener("dragend", () => { row.classList.remove("is-dragging"); document.querySelectorAll(".photo-row").forEach((r) => r.classList.remove("is-drag-over")); });
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("is-drag-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("is-drag-over");
      const from = state.dragSrcIndex;
      if (from === null || from === index) return;
      const [moved] = state.draftPhotos.splice(from, 1);
      state.draftPhotos.splice(index, 0, moved);
      state.dragSrcIndex = null;
      renderAll();
    });

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    row.appendChild(handle);

    const thumb = document.createElement("div");
    thumb.className = "photo-thumb";
    if (photo.dataUrl) thumb.style.backgroundImage = `url("${photo.dataUrl}")`;
    row.appendChild(thumb);

    const main = document.createElement("div");
    main.className = "photo-row-main";
    const title = document.createElement("div");
    title.className = "photo-row-title";
    title.textContent = photo.sourceId ? `Foto ${index + 1}` : photo.fromAlbumId ? `Foto ${index + 1} (do álbum)` : `Foto ${index + 1} (nova)`;
    main.appendChild(title);

    const fitToggle = document.createElement("div");
    fitToggle.className = "fit-toggle";
    ["contain", "cover"].forEach((fitValue) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = fitValue === "contain" ? "Conter" : "Preencher";
      b.className = photo.fit === fitValue ? "is-active" : "";
      b.addEventListener("click", () => { photo.fit = fitValue; renderAll(); });
      fitToggle.appendChild(b);
    });
    main.appendChild(fitToggle);
    row.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "photo-row-actions";

    const reorderBtns = document.createElement("div");
    reorderBtns.className = "reorder-btns";
    const upBtn = document.createElement("button");
    upBtn.className = "btn btn-ghost btn-icon";
    upBtn.type = "button"; upBtn.textContent = "↑"; upBtn.title = "Mover para cima";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      [state.draftPhotos[index - 1], state.draftPhotos[index]] = [state.draftPhotos[index], state.draftPhotos[index - 1]];
      renderAll();
    });
    const downBtn = document.createElement("button");
    downBtn.className = "btn btn-ghost btn-icon";
    downBtn.type = "button"; downBtn.textContent = "↓"; downBtn.title = "Mover para baixo";
    downBtn.disabled = index === state.draftPhotos.length - 1;
    downBtn.addEventListener("click", () => {
      [state.draftPhotos[index + 1], state.draftPhotos[index]] = [state.draftPhotos[index], state.draftPhotos[index + 1]];
      renderAll();
    });
    reorderBtns.appendChild(upBtn);
    reorderBtns.appendChild(downBtn);
    actions.appendChild(reorderBtns);

    const likeBtn = document.createElement("button");
    likeBtn.className = "like-btn"; likeBtn.type = "button";
    const albumEntry = photo.sourceId ? state.album.find((a) => a.sourcePhotoId === photo.sourceId) : null;
    likeBtn.classList.toggle("is-liked", !!albumEntry);
    likeBtn.textContent = albumEntry ? "♥" : "♡";
    likeBtn.title = photo.sourceId ? (albumEntry ? "Remover do álbum" : "Favoritar") : "Publique antes de favoritar";
    likeBtn.disabled = !photo.sourceId;
    likeBtn.addEventListener("click", async () => {
      likeBtn.disabled = true;
      if (albumEntry) {
        await API.unlikePhoto(state.sessionToken, albumEntry.id);
      } else {
        const result = await API.likePhoto(state.sessionToken, photo.sourceId);
        if (!result.ok && result.error === "album_full") showToast("Álbum cheio. Remova uma foto antes de adicionar outra.", true);
      }
      await loadAlbum();
      renderPhotoList();
    });
    actions.appendChild(likeBtn);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost btn-icon btn-remove";
    removeBtn.textContent = "Remover"; removeBtn.type = "button";
    removeBtn.addEventListener("click", () => {
      if (photo.dataUrl && !photo.sourceId) URL.revokeObjectURL(photo.dataUrl);
      state.draftPhotos.splice(index, 1);
      renderAll();
    });
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    container.appendChild(row);
  });

  document.getElementById("photo-count-label").textContent = `${state.draftPhotos.length} de ${MAX_PHOTOS}`;
  const addBtn = document.getElementById("add-photo-btn");
  addBtn.style.opacity = state.draftPhotos.length >= MAX_PHOTOS ? "0.4" : "1";
  document.getElementById("add-photo-input").disabled = state.draftPhotos.length >= MAX_PHOTOS;
}

/* ==========================================================================
   ADICIONAR FOTOS
   ========================================================================== */

document.getElementById("add-photo-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  const errorEl = document.getElementById("upload-error");
  errorEl.hidden = true;
  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  const maxBytes = 10 * 1024 * 1024;
  const remainingSlots = MAX_PHOTOS - state.draftPhotos.length;

  if (files.length > remainingSlots) {
    errorEl.textContent = `Só cabem mais ${remainingSlots} foto(s) (limite de ${MAX_PHOTOS}).`;
    errorEl.hidden = false;
  }

  for (const file of files.slice(0, remainingSlots)) {
    if (!validTypes.includes(file.type)) { errorEl.textContent = "Formato não suportado. Use JPEG, PNG ou WebP."; errorEl.hidden = false; continue; }
    if (file.size > maxBytes) { errorEl.textContent = "Um dos arquivos passa de 10 MB e foi ignorado."; errorEl.hidden = false; continue; }
    const dataUrl = URL.createObjectURL(file);
    trackObjectUrl(dataUrl);
    state.draftPhotos.push({ localId: uid(), sourceId: null, dataUrl, file, fit: "cover", crop: defaultCrop() });
  }
  renderAll();
  e.target.value = "";
});

/* ==========================================================================
   RENDER GERAL
   ========================================================================== */

function renderAll() {
  renderDraftPill();
  renderOrientationButtons();
  renderLayoutButtons();
  renderMockup("frame-mockup", state.draftOrientation, state.draftLayoutTemplate, state.draftPhotos, true);
  renderPhotoList();

  const anyCover = state.draftPhotos.some((p) => p.fit === "cover");
  document.getElementById("crop-hint").hidden = !anyCover;

  const changed = hasChanges();
  document.getElementById("btn-preview").disabled = !changed;
  document.getElementById("draft-status").textContent = changed ? "Composição pronta para revisão." : "Nada alterado ainda.";
}

/* ==========================================================================
   PRÉVIA + PUBLICAÇÃO
   ========================================================================== */

const modal = document.getElementById("modal-confirm");

document.getElementById("btn-preview").addEventListener("click", () => {
  renderMockup("modal-frame-mockup", state.draftOrientation, state.draftLayoutTemplate, state.draftPhotos, false);
  document.getElementById("publish-error").hidden = true;
  modal.hidden = false;
});
document.getElementById("btn-cancel-publish").addEventListener("click", () => { modal.hidden = true; });

document.getElementById("btn-confirm-publish").addEventListener("click", async () => {
  const confirmBtn = document.getElementById("btn-confirm-publish");
  const errorEl = document.getElementById("publish-error");
  errorEl.hidden = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Publicando…";

  const result = await API.publish(state.sessionToken, {
    base_version: state.publishedVersion, orientation: state.draftOrientation, layoutTemplate: state.draftLayoutTemplate, photos: state.draftPhotos,
  });

  confirmBtn.disabled = false;
  confirmBtn.textContent = "Publicar";

  if (!result.ok) {
    errorEl.textContent = result.error === "network_error" ? "Sem conexão com o servidor. O quadro continua como estava." : "Não foi possível publicar. O quadro continua como estava.";
    errorEl.hidden = false;
    return;
  }

  modal.hidden = true;
  showToast("Publicado — versão " + result.version);
  await loadEditor();

  const status = await API.getStatus(state.sessionToken);
  if (status) showToast(status.online ? "Dispositivo atualizado." : "Dispositivo offline — a atualização será sincronizada quando ele voltar.");
});

/* ==========================================================================
   ÁLBUM (página própria + lightbox)
   ========================================================================== */

async function loadAlbum() {
  state.album.forEach((p) => URL.revokeObjectURL(p.dataUrl));
  const result = await API.getAlbum(state.sessionToken);
  state.album = result.photos;
  state.albumLimit = result.limit;
  document.getElementById("nav-album-count").textContent = state.album.length;
  renderAlbumPage();
  renderPhotoList();
}

function renderAlbumPage() {
  document.getElementById("album-count-label").textContent = `${state.album.length} de ${state.albumLimit}`;
  const grid = document.getElementById("album-grid");
  grid.innerHTML = "";

  if (state.album.length === 0) {
    const note = document.createElement("p");
    note.className = "album-empty-note";
    note.innerHTML = `<svg class="icon" viewBox="0 0 24 24" width="28" height="28" style="display:block;margin:0 auto 8px;opacity:0.5;"><path fill="currentColor" d="m12 21-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6.01 6.01 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.19L12 21Z"/></svg>Nenhuma foto favoritada ainda. Favorite fotos na aba Editor.`;
    grid.appendChild(note);
    return;
  }

  state.album.forEach((photo) => {
    const item = document.createElement("div");
    item.className = "album-item";
    const bg = document.createElement("div");
    bg.className = "album-item-bg";
    bg.style.backgroundImage = `url("${photo.dataUrl}")`;
    item.appendChild(bg);
    item.addEventListener("click", () => openLightbox(photo));
    grid.appendChild(item);
  });
}

const lightbox = document.getElementById("modal-lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxWrap = document.getElementById("lightbox-image-wrap");

function openLightbox(photo) {
  state.lightboxAlbumId = photo.id;
  lightboxImage.src = photo.dataUrl;
  lightboxWrap.classList.remove("is-zoomed");
  document.getElementById("lightbox-hint").textContent = "Clique na foto pra ampliar";
  lightbox.hidden = false;
}
document.getElementById("lightbox-close").addEventListener("click", () => { lightbox.hidden = true; });
lightboxImage.addEventListener("click", () => {
  const zoomed = lightboxWrap.classList.toggle("is-zoomed");
  document.getElementById("lightbox-hint").textContent = zoomed ? "Clique pra reduzir" : "Clique na foto pra ampliar";
});
document.getElementById("lightbox-remove").addEventListener("click", async () => {
  if (!state.lightboxAlbumId) return;
  await API.unlikePhoto(state.sessionToken, state.lightboxAlbumId);
  lightbox.hidden = true;
  await loadAlbum();
  showToast("Removida do álbum.");
});

/* ==========================================================================
   ESCOLHER FOTOS DO ÁLBUM PRA COMPOSIÇÃO
   ========================================================================== */

const albumPickerModal = document.getElementById("modal-album-picker");
let albumPickerSelection = new Set();

document.getElementById("choose-from-album-btn").addEventListener("click", () => {
  if (state.album.length === 0) {
    showToast("Seu álbum ainda não tem fotos favoritadas.", true);
    return;
  }
  albumPickerSelection = new Set();
  renderAlbumPickerGrid();
  albumPickerModal.hidden = false;
});

function renderAlbumPickerGrid() {
  const grid = document.getElementById("album-picker-grid");
  grid.innerHTML = "";
  const remaining = MAX_PHOTOS - state.draftPhotos.length;

  state.album.forEach((photo) => {
    const item = document.createElement("div");
    const disabled = albumPickerSelection.size >= remaining && !albumPickerSelection.has(photo.id);
    item.className = "album-picker-item" + (disabled ? " album-picker-disabled" : "");

    const bg = document.createElement("div");
    bg.className = "album-picker-item-bg";
    bg.style.backgroundImage = `url("${photo.dataUrl}")`;
    item.appendChild(bg);

    const check = document.createElement("div");
    check.className = "album-picker-check";
    check.textContent = "✓";
    item.appendChild(check);

    if (albumPickerSelection.has(photo.id)) item.classList.add("is-selected");

    item.addEventListener("click", () => {
      if (disabled && !albumPickerSelection.has(photo.id)) return;
      if (albumPickerSelection.has(photo.id)) albumPickerSelection.delete(photo.id);
      else albumPickerSelection.add(photo.id);
      renderAlbumPickerGrid();
    });

    grid.appendChild(item);
  });

  document.getElementById("album-picker-confirm").disabled = albumPickerSelection.size === 0;
}

document.getElementById("album-picker-close").addEventListener("click", () => { albumPickerModal.hidden = true; });

document.getElementById("album-picker-confirm").addEventListener("click", async () => {
  const btn = document.getElementById("album-picker-confirm");
  btn.disabled = true;
  btn.textContent = "Adicionando…";

  for (const albumId of albumPickerSelection) {
    const albumPhoto = state.album.find((a) => a.id === albumId);
    if (!albumPhoto) continue;
    const dataUrl = await API.getAlbumPhotoBlobUrl(state.sessionToken, albumId);
    trackObjectUrl(dataUrl);
    state.draftPhotos.push({ localId: uid(), sourceId: null, fromAlbumId: albumId, dataUrl, file: null, fit: "cover", crop: defaultCrop() });
  }

  btn.disabled = false;
  btn.textContent = "Adicionar selecionadas";
  albumPickerModal.hidden = true;
  renderAll();
});

/* ==========================================================================
   CONFIGURAÇÕES (modal)
   ========================================================================== */

async function loadSettings() {
  const result = await API.getSettings(state.sessionToken);
  if (!result) return;
  document.getElementById("device-name-input").value = result.device_name || "";
  state.frameStyle = result.settings?.frame_style || "classica";
  renderMolduraButtons();
  renderAll(); // reaplica a moldura no mockup já visível
}

function renderMolduraButtons() {
  document.querySelectorAll(".moldura-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-moldura") === state.frameStyle);
  });
}

document.querySelectorAll(".moldura-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.frameStyle = btn.getAttribute("data-moldura");
    renderMolduraButtons();
    renderAll();
  });
});

const settingsModal = document.getElementById("modal-settings");
document.getElementById("btn-settings").addEventListener("click", () => { settingsModal.hidden = false; });
document.getElementById("close-settings-btn").addEventListener("click", () => { settingsModal.hidden = true; });

document.getElementById("save-settings-btn").addEventListener("click", async () => {
  const deviceName = document.getElementById("device-name-input").value.trim();
  const btn = document.getElementById("save-settings-btn");
  btn.disabled = true; btn.textContent = "Salvando…";

  const result = await API.updateSettings(state.sessionToken, { deviceName, frameStyle: state.frameStyle });

  btn.disabled = false; btn.textContent = "Salvar";
  const note = document.getElementById("settings-saved-note");
  note.textContent = result.ok ? "Salvo." : "Não foi possível salvar agora.";
  note.hidden = false;
  setTimeout(() => (note.hidden = true), 2200);
});

/* ==========================================================================
   START
   ========================================================================== */

init();
