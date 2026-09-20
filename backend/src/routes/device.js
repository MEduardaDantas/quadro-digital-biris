const express = require("express");
const fs = require("fs");
const { pool } = require("../db");
const storage = require("../storage");

const router = express.Router();

async function resolveFrameByToken(frameToken) {
  const result = await pool.query("SELECT id FROM frames WHERE token = $1", [frameToken]);
  return result.rows[0]?.id || null;
}

// GET /api/v1/device/current?frame_token=demo-frame
router.get("/api/v1/device/current", async (req, res) => {
  const frameToken = req.query.frame_token;
  if (!frameToken) return res.status(400).json({ error: "missing_frame_token" });

  const frameId = await resolveFrameByToken(frameToken);
  if (!frameId) return res.status(404).json({ error: "frame_not_found" });

  const result = await pool.query("SELECT * FROM current_state WHERE frame_id = $1", [frameId]);
  const state = result.rows[0];
  if (!state) return res.status(404).json({ error: "state_not_found" });

  const photos = (state.photos || []).map((p) => ({
    id: p.id,
    fit: p.fit || "contain",
    crop: p.crop || { x: 50, y: 50, zoom: 1 },
    url: `/api/v1/device/current/photos/${p.id}?frame_token=${encodeURIComponent(frameToken)}`,
  }));

  return res.json({
    frame_id: frameId,
    version: state.version,
    orientation: state.orientation,
    layout_template: state.layout_template,
    photos,
  });
});

// GET /api/v1/device/current/photos/:photoId?frame_token=demo-frame
router.get("/api/v1/device/current/photos/:photoId", async (req, res) => {
  const frameToken = req.query.frame_token;
  if (!frameToken) return res.status(400).json({ error: "missing_frame_token" });

  const frameId = await resolveFrameByToken(frameToken);
  if (!frameId) return res.status(404).json({ error: "frame_not_found" });

  const result = await pool.query("SELECT photos FROM current_state WHERE frame_id = $1", [
    frameId,
  ]);
  const photo = result.rows[0]?.photos?.find((p) => p.id === req.params.photoId);

  if (!photo || !storage.fileExists(photo.path)) {
    return res.status(404).json({ error: "photo_not_found" });
  }

  res.setHeader("Content-Type", photo.mime || "application/octet-stream");
  fs.createReadStream(photo.path).pipe(res);
});

// POST /api/v1/device/ack   { frame_token, version, battery_pct?, storage_used_mb?, storage_total_mb? }
//
// O dispositivo chama isso depois de aplicar uma composição com sucesso.
// battery_pct/storage_* são opcionais — só são gravados se o dispositivo
// realmente os enviar. Não inventamos valor nenhum aqui.
router.post("/api/v1/device/ack", async (req, res) => {
  const { frame_token, version, battery_pct, storage_used_mb, storage_total_mb } = req.body || {};
  if (!frame_token || typeof version !== "number") {
    return res.status(400).json({ error: "missing_fields" });
  }

  const frameId = await resolveFrameByToken(frame_token);
  if (!frameId) return res.status(404).json({ error: "frame_not_found" });

  // COALESCE com o valor já existente: se o dispositivo não mandar
  // battery_pct nesta chamada, não apaga o último valor conhecido.
  await pool.query(
    `INSERT INTO device_status (frame_id, applied_version, last_seen_at, battery_pct, storage_used_mb, storage_total_mb)
     VALUES ($1, $2, now(), $3, $4, $5)
     ON CONFLICT (frame_id) DO UPDATE
       SET applied_version = EXCLUDED.applied_version,
           last_seen_at = now(),
           battery_pct = COALESCE(EXCLUDED.battery_pct, device_status.battery_pct),
           storage_used_mb = COALESCE(EXCLUDED.storage_used_mb, device_status.storage_used_mb),
           storage_total_mb = COALESCE(EXCLUDED.storage_total_mb, device_status.storage_total_mb)`,
    [frameId, version, battery_pct ?? null, storage_used_mb ?? null, storage_total_mb ?? null]
  );

  return res.status(204).send();
});

// POST /api/v1/device/like   { frame_token, photo_id, liked }
//
// O toque na foto no dispositivo (seção 14) chama isso. liked=true copia
// a foto da composição atual pro álbum (sobrevive a publicações futuras);
// liked=false remove do álbum qualquer cópia que tenha vindo dessa foto.
router.post("/api/v1/device/like", async (req, res) => {
  const { frame_token, photo_id, liked } = req.body || {};
  if (!frame_token || !photo_id || typeof liked !== "boolean") {
    return res.status(400).json({ error: "missing_fields" });
  }

  const frameId = await resolveFrameByToken(frame_token);
  if (!frameId) return res.status(404).json({ error: "frame_not_found" });

  if (liked) {
    const stateResult = await pool.query("SELECT photos FROM current_state WHERE frame_id = $1", [
      frameId,
    ]);
    const photo = stateResult.rows[0]?.photos?.find((p) => p.id === photo_id);
    if (!photo || !storage.fileExists(photo.path)) {
      return res.status(404).json({ error: "photo_not_in_composition" });
    }

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM album_photos WHERE frame_id = $1",
      [frameId]
    );
    if (countResult.rows[0].count >= 50) {
      return res.status(409).json({ error: "album_full" });
    }

    const copied = storage.copyToAlbum(frameId, photo.path, photo.mime);
    await pool.query(
      "INSERT INTO album_photos (id, frame_id, path, mime, source_photo_id) VALUES ($1, $2, $3, $4, $5)",
      [copied.id, frameId, copied.path, photo.mime, photo_id]
    );
    return res.status(201).json({ album_id: copied.id });
  }

  // unlike: remove qualquer entrada do álbum originada dessa foto
  const existing = await pool.query(
    "SELECT id, path FROM album_photos WHERE frame_id = $1 AND source_photo_id = $2",
    [frameId, photo_id]
  );
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "not_liked" });
  }
  for (const row of existing.rows) {
    storage.deleteAlbumFile(row.path);
  }
  await pool.query("DELETE FROM album_photos WHERE frame_id = $1 AND source_photo_id = $2", [
    frameId,
    photo_id,
  ]);
  return res.status(204).send();
});

module.exports = router;
