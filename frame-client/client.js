// Cliente de quadro — simula o dispositivo físico.
//
// Mudou nesta versão:
//   - composição agora é uma lista de fotos (até 8), não mais slot1/2/3 fixos;
//   - cada foto tem seu próprio "fit" (contain/cover);
//   - existe orientação (landscape/portrait);
//   - o cliente agora CONFIRMA pro backend qual versão aplicou de verdade
//     (POST /api/v1/device/ack) — antes o backend nunca sabia se o
//     dispositivo realmente processou o evento.
//
// Limitação real e documentada: o hardware atual só sabe desenhar 3 fotos
// na tela (ver seção 5 do briefing). Este simulador baixa e cacheia TODAS
// as fotos da composição (até 8) — não descarta o modelo — mas só "exibe"
// (loga) as 3 primeiras, deixando isso explícito no log.

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const FRAME_TOKEN = process.env.FRAME_TOKEN || "demo-frame";
const HTTP_BASE = process.env.BACKEND_HTTP_URL || "http://localhost:3000";
const WS_URL = process.env.BACKEND_WS_URL || "http://localhost:3000".replace("http", "ws") + "/api/v1/device/ws";
const LOCAL_DIR = path.resolve(process.env.LOCAL_DIR || "./local");
const RECONNECT_DELAY_MS = 3000;
const DISPLAY_LIMIT = 3; // limitação real do hardware atual, não do protocolo

fs.mkdirSync(LOCAL_DIR, { recursive: true });
const STATE_FILE = path.join(LOCAL_DIR, "state.json");

function log(...args) {
  console.log(`[quadro:${FRAME_TOKEN}]`, ...args);
}

function loadLocalState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { version: 0, orientation: "landscape", photos: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    log("state.json corrompido, tratando como versão 0.");
    return { version: 0, orientation: "landscape", photos: [] };
  }
}

function saveLocalState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function extFromContentType(ct) {
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  return "bin";
}

function clearOldPhotoFiles() {
  if (!fs.existsSync(LOCAL_DIR)) return;
  for (const f of fs.readdirSync(LOCAL_DIR)) {
    if (f.startsWith("photo-")) fs.unlinkSync(path.join(LOCAL_DIR, f));
  }
}

async function downloadPhoto(photoId, relativeUrl) {
  const res = await fetch(HTTP_BASE + relativeUrl);
  if (!res.ok) throw new Error(`falha ao baixar foto ${photoId}: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const filename = `photo-${photoId}.${extFromContentType(contentType)}`;
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(LOCAL_DIR, filename), buffer);
  return filename;
}

async function ackVersion(version) {
  try {
    await fetch(`${HTTP_BASE}/api/v1/device/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame_token: FRAME_TOKEN, version }),
    });
  } catch (err) {
    log("não consegui confirmar a versão pro backend (não crítico):", err.message);
  }
}

async function sync() {
  const local = loadLocalState();

  let remote;
  try {
    const res = await fetch(
      `${HTTP_BASE}/api/v1/device/current?frame_token=${encodeURIComponent(FRAME_TOKEN)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    remote = await res.json();
  } catch (err) {
    log("não foi possível consultar o backend agora, mantendo estado local:", err.message);
    return;
  }

  if (remote.version === local.version) {
    log(`já está na versão ${local.version}, nada a sincronizar.`);
    return;
  }

  log(
    `nova versão disponível: local=${local.version} servidor=${remote.version} ` +
      `(${remote.photos.length} foto(s), orientação ${remote.orientation}) — sincronizando…`
  );

  clearOldPhotoFiles();
  const downloaded = [];
  for (const photo of remote.photos) {
    const filename = await downloadPhoto(photo.id, photo.url);
    downloaded.push({ id: photo.id, filename, fit: photo.fit });
  }

  const newLocal = {
    version: remote.version,
    orientation: remote.orientation,
    photos: downloaded,
  };
  saveLocalState(newLocal);

  const shown = downloaded.slice(0, DISPLAY_LIMIT);
  const cachedOnly = downloaded.slice(DISPLAY_LIMIT);
  log(`sincronizado. exibindo ${shown.length} foto(s) na tela:`, shown.map((p) => p.filename));
  if (cachedOnly.length > 0) {
    log(
      `${cachedOnly.length} foto(s) a mais ficaram em cache mas não são exibidas ` +
        `— hardware atual só renderiza ${DISPLAY_LIMIT}.`
    );
  }

  await ackVersion(remote.version);
}

function connect() {
  log(`conectando em ${WS_URL} …`);
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    log("conexão aberta, identificando…");
    ws.send(JSON.stringify({ frame_token: FRAME_TOKEN }));
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.event === "IDENTIFIED") {
      log(`identificado como frame_id=${msg.frame_id}. verificando se há atualização pendente…`);
      await sync();
    } else if (msg.event === "PHOTO_UPDATED") {
      log(`evento recebido: PHOTO_UPDATED (versão ${msg.version})`);
      await sync();
    } else if (msg.event === "ERROR") {
      log("erro do servidor:", msg.error);
    }
  });

  ws.on("close", () => {
    log(`conexão perdida. mostrando última composição local conhecida. tentando reconectar em ${RECONNECT_DELAY_MS}ms…`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    log("erro na conexão:", err.message);
  });
}

async function main() {
  const local = loadLocalState();
  log(
    `iniciando. estado local atual: versão ${local.version}, orientação ${local.orientation}, ${local.photos.length} foto(s) em cache.`
  );
  connect();
}

main();
