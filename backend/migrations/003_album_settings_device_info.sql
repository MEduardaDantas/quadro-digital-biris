-- Álbum: fotos persistidas/favoritadas, independentes do ciclo de vida
-- da composição (que não guarda histórico). Cada foto do álbum tem seu
-- próprio arquivo copiado, pra sobreviver mesmo depois que a foto sair
-- da composição atual.
CREATE TABLE IF NOT EXISTS album_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frame_id UUID NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  source_photo_id TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_album_photos_frame ON album_photos(frame_id);

-- Configurações remotas (seção 19): nome do quadro e slideshow.
-- Ficam em frames, não em current_state, porque não são parte da
-- composição nem precisam de versionamento/publicação.
ALTER TABLE frames
  ADD COLUMN device_name TEXT,
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{"slideshow_enabled": false, "slideshow_duration_seconds": 20}'::jsonb;

-- Informação real do dispositivo (bateria/storage), só preenchida quando
-- o próprio dispositivo reportar — nunca inventada pelo backend.
ALTER TABLE device_status
  ADD COLUMN battery_pct INTEGER,
  ADD COLUMN storage_used_mb INTEGER,
  ADD COLUMN storage_total_mb INTEGER;
