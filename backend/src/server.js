require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { pool } = require("./db");
const wsHub = require("./wsHub");
const authRoutes = require("./routes/auth");
const frameRoutes = require("./routes/frame");
const deviceRoutes = require("./routes/device");

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(authRoutes);
app.use(frameRoutes);
app.use(deviceRoutes);

app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large" });
  }
  res.status(500).json({ error: "internal_error" });
});

const server = http.createServer(app);

// ============================================================
// WebSocket — canal do dispositivo (quadro físico / simulador)
// GET wss://.../api/v1/device/ws
//
// Protocolo mínimo:
//   1. cliente conecta
//   2. cliente envia, como primeira mensagem: {"frame_token": "demo-frame"}
//   3. servidor responde {"event": "IDENTIFIED", "frame_id": "..."}
//   4. quando houver publicação, servidor envia {"event":"PHOTO_UPDATED", ...}
// ============================================================
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  let identifiedFrameId = null;

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ event: "ERROR", error: "invalid_json" }));
      return;
    }

    if (msg.frame_token && !identifiedFrameId) {
      const result = await pool.query("SELECT id FROM frames WHERE token = $1", [
        msg.frame_token,
      ]);
      const frame = result.rows[0];
      if (!frame) {
        ws.send(JSON.stringify({ event: "ERROR", error: "frame_not_found" }));
        ws.close();
        return;
      }
      identifiedFrameId = frame.id;
      wsHub.register(identifiedFrameId, ws);
      ws.send(JSON.stringify({ event: "IDENTIFIED", frame_id: identifiedFrameId }));
    }
  });

  ws.on("close", () => {
    if (identifiedFrameId) wsHub.unregister(identifiedFrameId, ws);
  });
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/api/v1/device/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
  console.log(`WebSocket do dispositivo em ws://localhost:${PORT}/api/v1/device/ws`);
});
