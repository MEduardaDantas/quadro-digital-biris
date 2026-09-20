-- Composição deixa de ser 3 colunas fixas (slot1/2/3) e passa a ser uma
-- lista ordenada de até 8 fotos. Cada item carrega seu próprio id estável
-- (útil pro portal referenciar "mantenha esta foto" sem depender de posição)
-- e seu próprio fit (contain/cover).
--
-- Também adiciona device_status: hoje o dispositivo baixa o estado mas
-- nunca confirma pro backend qual versão aplicou de fato. Sem isso não dá
-- pra saber se ele está "atualizado" ou só "publicado, mas não confirmado".

ALTER TABLE current_state
  ADD COLUMN orientation TEXT NOT NULL DEFAULT 'landscape'
    CHECK (orientation IN ('landscape', 'portrait')),
  ADD COLUMN photos JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_array_length(photos) <= 8);

-- Migra os dados existentes (slot1/2/3) para o novo formato de array.
UPDATE current_state SET photos = COALESCE(
  (
    SELECT jsonb_agg(item ORDER BY ord)
    FROM (
      SELECT 1 AS ord, jsonb_build_object(
               'id', gen_random_uuid()::text,
               'path', slot1_path, 'mime', slot1_mime, 'fit', 'contain'
             ) AS item
      WHERE slot1_path IS NOT NULL
      UNION ALL
      SELECT 2, jsonb_build_object(
               'id', gen_random_uuid()::text,
               'path', slot2_path, 'mime', slot2_mime, 'fit', 'contain'
             )
      WHERE slot2_path IS NOT NULL
      UNION ALL
      SELECT 3, jsonb_build_object(
               'id', gen_random_uuid()::text,
               'path', slot3_path, 'mime', slot3_mime, 'fit', 'contain'
             )
      WHERE slot3_path IS NOT NULL
    ) sub
  ),
  '[]'::jsonb
);

ALTER TABLE current_state
  DROP COLUMN slot1_path, DROP COLUMN slot1_mime,
  DROP COLUMN slot2_path, DROP COLUMN slot2_mime,
  DROP COLUMN slot3_path, DROP COLUMN slot3_mime;

CREATE TABLE IF NOT EXISTS device_status (
  frame_id UUID PRIMARY KEY REFERENCES frames(id) ON DELETE CASCADE,
  applied_version INTEGER,
  last_seen_at TIMESTAMPTZ
);
