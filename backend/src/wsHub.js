// Mantém, em memória, quais conexões WebSocket de quadro estão
// identificadas para cada frame_id, e permite notificar todas elas.

const connectionsByFrame = new Map(); // frameId -> Set<ws>

function register(frameId, ws) {
  if (!connectionsByFrame.has(frameId)) {
    connectionsByFrame.set(frameId, new Set());
  }
  connectionsByFrame.get(frameId).add(ws);
}

function unregister(frameId, ws) {
  const set = connectionsByFrame.get(frameId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connectionsByFrame.delete(frameId);
}

function broadcastPhotoUpdated(frameId, version) {
  const set = connectionsByFrame.get(frameId);
  if (!set || set.size === 0) return 0;

  const payload = JSON.stringify({
    event: "PHOTO_UPDATED",
    frame_id: frameId,
    version,
  });

  let sent = 0;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      sent += 1;
    }
  }
  return sent;
}

function connectedDeviceCount(frameId) {
  return connectionsByFrame.get(frameId)?.size || 0;
}

module.exports = { register, unregister, broadcastPhotoUpdated, connectedDeviceCount };
