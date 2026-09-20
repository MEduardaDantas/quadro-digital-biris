const express = require("express");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../db");
const { requireSession } = require("../middleware/session");
const storage = require("../storage");
const wsHub = require("../wsHub");

const router = express.Router();

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 10);
const MAX_PHOTOS = 8;
const MAX_ALBUM = 50;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const VALID_FIT = new Set(["contain", "cover"]);
const VALID_ORIENTATION = new Set(["landscape", "portrait"]);
const VALID_LAYOUT = new Set(["uniform", "feature", "grid"]);
const VALID_ACTIONS = new Set(["keep", "new", "from_album"]);
const DEFAULT_CROP = { x: 50, y: 50, zoom: 1 };

function normalizeCrop(crop) {
  if (!crop || typeof crop !== "object") return { ...DEFAULT_CROP };
  const x = Number(crop.x);
  const y = Number(crop.y);
  const zoom = Number(crop.zoom);
  return {
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : DEFAULT_CROP.x,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : DEFAULT_CROP.y,
    zoom: Number.isFinite(zoom) ? Math.min(3, Math.max(1, zoom)) : DEFAULT_CROP.zoom,
  };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storage.tmpDir()),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

function sniffImageMime(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function photosToResponse(state) {
  return (state.photos || []).map((p) => ({
    id: p.id,
    fit: p.fit || "contain",
    crop: normalizeCrop(p.crop),
    url: `/api/v1/frame/current/photos/${p.id}`,
  }));
}

// GET /api/v1/frame/current
router.get("/api/v1/frame/current", requireSession, async (req, res) => {
  const result = await pool.query("SELECT * FROM current_state WHERE frame_id = $1", [
    req.frameId,
  ]);
  const state = result.rows[0];
  if (!state) return res.status(404).json({ error: "state_not_found" });

  return res.json({
    frame_id: req.frameId,
    version: state.version,
    orientation: state.orientation,
    layout_template: state.layout_template,
    photos: photosToResponse(state),
  });
});

// GET /api/v1/frame/current/photos/:photoId
router.get("/api/v1/frame/current/photos/:photoId", requireSession, async (req, res) => {
  const result = await pool.query("SELECT photos FROM current_state WHERE frame_id = $1", [
    req.frameId,
  ]);
  const state = result.rows[0];
  const photo = state?.photos?.find((p) => p.id === req.params.photoId);

  if (!photo || !storage.fileExists(photo.path)) {
    return res.status(404).json({ error: "photo_not_found" });
  }

  res.setHeader("Content-Type", photo.mime || "application/octet-stream");
  fs.createReadStream(photo.path).pipe(res);
});

// GET /api/v1/frame/status
// Estado real de sincronização do dispositivo — nada aqui é inventado:
// "online" vem da conexão WebSocket ativa agora; "device_version" só
// existe se o dispositivo já confirmou (POST /api/v1/device/ack) alguma vez.
router.get("/api/v1/frame/status", requireSession, async (req, res) => {
  const stateResult = await pool.query(
    "SELECT version FROM current_state WHERE frame_id = $1",
    [req.frameId]
  );
  const statusResult = await pool.query(
    "SELECT applied_version, last_seen_at, battery_pct, storage_used_mb, storage_total_mb FROM device_status WHERE frame_id = $1",
    [req.frameId]
  );

  const publishedVersion = stateResult.rows[0]?.version ?? null;
  const deviceRow = statusResult.rows[0];
  const online = wsHub.connectedDeviceCount(req.frameId) > 0;

  let syncState = "unknown"; // nunca confirmou nenhuma versão
  if (deviceRow?.applied_version != null) {
    if (deviceRow.applied_version === publishedVersion) syncState = "updated";
    else if (online) syncState = "syncing";
    else syncState = "outdated";
  }

  return res.json({
    online,
    published_version: publishedVersion,
    device_version: deviceRow?.applied_version ?? null,
    last_seen_at: deviceRow?.last_seen_at ?? null,
    sync_state: syncState,
    // Informação real do dispositivo (seção 20). null vira "N/A" no
    // portal — nunca inventamos um valor aqui.
    battery_pct: deviceRow?.battery_pct ?? null,
    storage_used_mb: deviceRow?.storage_used_mb ?? null,
    storage_total_mb: deviceRow?.storage_total_mb ?? null,
  });
});

// POST /api/v1/frame/publications
//
// manifest: {
//   base_version: number,
//   orientation: "landscape" | "portrait",
//   photos: [
//     { action: "keep", id: "<id existente>", fit?: "contain"|"cover" },
//     { action: "new", temp_key: "p1", fit?: "contain"|"cover" }  // arquivo vem no campo "photo_p1"
//   ]
// }
router.post("/api/v1/frame/publications", requireSession, upload.any(), async (req, res) => {
  const uploadedFiles = req.files || [];
  const fileByFieldName = new Map(uploadedFiles.map((f) => [f.fieldname, f]));

  const cleanupTempFiles = () => {
    for (const f of uploadedFiles) {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
  };

  let manifest;
  try {
    manifest = JSON.parse(req.body.manifest || "");
  } catch {
    cleanupTempFiles();
    return res.status(400).json({ error: "invalid_manifest" });
  }

  if (!manifest || !Array.isArray(manifest.photos)) {
    cleanupTempFiles();
    return res.status(400).json({ error: "invalid_manifest" });
  }
  if (manifest.photos.length > MAX_PHOTOS) {
    cleanupTempFiles();
    return res.status(400).json({ error: "too_many_photos", max: MAX_PHOTOS });
  }
  const orientation = manifest.orientation || "landscape";
  if (!VALID_ORIENTATION.has(orientation)) {
    cleanupTempFiles();
    return res.status(400).json({ error: "invalid_orientation" });
  }
  const layoutTemplate = manifest.layout_template || "uniform";
  if (!VALID_LAYOUT.has(layoutTemplate)) {
    cleanupTempFiles();
    return res.status(400).json({ error: "invalid_layout_template" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      "SELECT * FROM current_state WHERE frame_id = $1 FOR UPDATE",
      [req.frameId]
    );
    const state = current.rows[0];
    if (!state) throw { status: 404, error: "state_not_found" };

    const existingById = new Map((state.photos || []).map((p) => [p.id, p]));
    const nextPhotos = [];

    for (const item of manifest.photos) {
      if (!VALID_ACTIONS.has(item.action)) {
        throw { status: 400, error: "invalid_action" };
      }
      const fit = item.fit || "contain";
      if (!VALID_FIT.has(fit)) throw { status: 400, error: "invalid_fit" };
      const crop = normalizeCrop(item.crop);

      if (item.action === "keep") {
        const existing = existingById.get(item.id);
        if (!existing) throw { status: 400, error: "unknown_photo_id", id: item.id };
        nextPhotos.push({ ...existing, fit, crop });
        continue;
      }

      if (item.action === "from_album") {
        const albumResult = await client.query(
          "SELECT path, mime FROM album_photos WHERE id = $1 AND frame_id = $2",
          [item.album_id, req.frameId]
        );
        const albumPhoto = albumResult.rows[0];
        if (!albumPhoto || !storage.fileExists(albumPhoto.path)) {
          throw { status: 400, error: "album_photo_not_found", album_id: item.album_id };
        }
        const photoId = uuidv4();
        const finalPath = storage.copyIntoComposition(req.frameId, photoId, albumPhoto.path, albumPhoto.mime);
        nextPhotos.push({ id: photoId, path: finalPath, mime: albumPhoto.mime, fit, crop });
        continue;
      }

      // action === "new"
      const file = fileByFieldName.get(`photo_${item.temp_key}`);
      if (!file) throw { status: 400, error: "missing_file", temp_key: item.temp_key };
      if (!ALLOWED_MIME.has(file.mimetype)) {
        throw { status: 400, error: "invalid_mime_type", temp_key: item.temp_key };
      }
      const sniffed = sniffImageMime(file.path);
      if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
        throw { status: 400, error: "file_is_not_a_valid_image", temp_key: item.temp_key };
      }

      const photoId = uuidv4();
      const finalPath = storage.commitPhotoFile(req.frameId, photoId, file.path, sniffed);
      nextPhotos.push({ id: photoId, path: finalPath, mime: sniffed, fit, crop });
    }

    // limpa do disco qualquer foto que não sobreviveu nesta publicação
    storage.garbageCollectPhotos(req.frameId, nextPhotos.map((p) => p.path));

    const newVersion = state.version + 1;

    await client.query(
      `UPDATE current_state
          SET version = $1, orientation = $2, layout_template = $3, photos = $4, updated_at = now()
        WHERE frame_id = $5`,
      [newVersion, orientation, layoutTemplate, JSON.stringify(nextPhotos), req.frameId]
    );
    await client.query("UPDATE frames SET current_version = $1 WHERE id = $2", [
      newVersion,
      req.frameId,
    ]);

    await client.query("COMMIT");

    const sentTo = wsHub.broadcastPhotoUpdated(req.frameId, newVersion);
    return res.json({ status: "published", version: newVersion, notified_devices: sentTo });
  } catch (err) {
    await client.query("ROLLBACK");
    cleanupTempFiles();
    if (err && err.status) {
      return res.status(err.status).json({ error: err.error, ...err });
    }
    console.error("Falha ao publicar:", err);
    return res.status(500).json({ error: "publish_failed" });
  } finally {
    client.release();
  }
});

// ============================================================
// ÁLBUM — fotos persistidas/favoritadas, independentes da composição.
// (seção 13/14/15 do briefing)
// ============================================================

// GET /api/v1/frame/album
router.get("/api/v1/frame/album", requireSession, async (req, res) => {
  const result = await pool.query(
    "SELECT id, added_at, source_photo_id FROM album_photos WHERE frame_id = $1 ORDER BY added_at ASC",
    [req.frameId]
  );
  const photos = result.rows.map((r) => ({
    id: r.id,
    added_at: r.added_at,
    source_photo_id: r.source_photo_id,
    url: `/api/v1/frame/album/${r.id}/photo`,
  }));
  return res.json({ photos, count: photos.length, limit: MAX_ALBUM });
});

// GET /api/v1/frame/album/:albumId/photo
router.get("/api/v1/frame/album/:albumId/photo", requireSession, async (req, res) => {
  const result = await pool.query(
    "SELECT path, mime FROM album_photos WHERE id = $1 AND frame_id = $2",
    [req.params.albumId, req.frameId]
  );
  const row = result.rows[0];
  if (!row || !storage.fileExists(row.path)) {
    return res.status(404).json({ error: "album_photo_not_found" });
  }
  res.setHeader("Content-Type", row.mime);
  fs.createReadStream(row.path).pipe(res);
});

// DELETE /api/v1/frame/album/:albumId
// "Remoção do álbum" (seção 16) — o dispositivo não tem essa capacidade,
// então isso só existe no portal, como o briefing pede explicitamente.
router.delete("/api/v1/frame/album/:albumId", requireSession, async (req, res) => {
  const result = await pool.query(
    "SELECT path FROM album_photos WHERE id = $1 AND frame_id = $2",
    [req.params.albumId, req.frameId]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: "album_photo_not_found" });

  await pool.query("DELETE FROM album_photos WHERE id = $1", [req.params.albumId]);
  storage.deleteAlbumFile(row.path);
  return res.status(204).send();
});

// POST /api/v1/frame/current/photos/:photoId/like
// O portal também pode favoritar uma foto da composição atual (não só o
// toque no dispositivo — ver seção 14, "o portal deve refletir esse
// estado", o que só faz sentido se o portal também puder originar a ação).
router.post("/api/v1/frame/current/photos/:photoId/like", requireSession, async (req, res) => {
  const stateResult = await pool.query("SELECT photos FROM current_state WHERE frame_id = $1", [
    req.frameId,
  ]);
  const photo = stateResult.rows[0]?.photos?.find((p) => p.id === req.params.photoId);
  if (!photo || !storage.fileExists(photo.path)) {
    return res.status(404).json({ error: "photo_not_found" });
  }

  const countResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM album_photos WHERE frame_id = $1",
    [req.frameId]
  );
  if (countResult.rows[0].count >= MAX_ALBUM) {
    return res.status(409).json({ error: "album_full", message: "Álbum cheio. Remova uma foto antes de adicionar outra." });
  }

  const copied = storage.copyToAlbum(req.frameId, photo.path, photo.mime);
  await pool.query(
    "INSERT INTO album_photos (id, frame_id, path, mime, source_photo_id) VALUES ($1, $2, $3, $4, $5)",
    [copied.id, req.frameId, copied.path, photo.mime, req.params.photoId]
  );

  return res.status(201).json({ album_id: copied.id });
});

// ============================================================
// CONFIGURAÇÕES REMOTAS (seção 19) — nome do quadro e slideshow.
// Separado de "informação do dispositivo" (seção 20), que é
// somente leitura e vem do próprio dispositivo.
// ============================================================

router.get("/api/v1/frame/settings", requireSession, async (req, res) => {
  const result = await pool.query("SELECT device_name, settings FROM frames WHERE id = $1", [
    req.frameId,
  ]);
  const row = result.rows[0];
  return res.json({ device_name: row.device_name, settings: row.settings });
});

router.put("/api/v1/frame/settings", requireSession, async (req, res) => {
  const { device_name, settings } = req.body || {};

  if (device_name !== undefined && typeof device_name !== "string") {
    return res.status(400).json({ error: "invalid_device_name" });
  }
  if (settings !== undefined && (typeof settings !== "object" || settings === null)) {
    return res.status(400).json({ error: "invalid_settings" });
  }

  const current = await pool.query("SELECT device_name, settings FROM frames WHERE id = $1", [
    req.frameId,
  ]);
  const row = current.rows[0];

  const nextDeviceName = device_name !== undefined ? device_name : row.device_name;
  const nextSettings = settings !== undefined ? { ...row.settings, ...settings } : row.settings;

  await pool.query("UPDATE frames SET device_name = $1, settings = $2 WHERE id = $3", [
    nextDeviceName,
    JSON.stringify(nextSettings),
    req.frameId,
  ]);

  return res.json({ device_name: nextDeviceName, settings: nextSettings });
});

module.exports = router;

