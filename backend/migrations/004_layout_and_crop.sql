-- Layout template: como as fotos se organizam dentro do quadro
-- (uniforme, destaque, grade). Guardado junto do estado publicado porque
-- é parte da composição, não uma preferência solta.
ALTER TABLE current_state
  ADD COLUMN layout_template TEXT NOT NULL DEFAULT 'uniform'
    CHECK (layout_template IN ('uniform', 'feature', 'grid'));

-- Estilo de moldura (borda decorativa): puramente visual do portal hoje —
-- ver README para por que isso ainda não é enviado ao dispositivo físico
-- (não existe pipeline de composição de imagem, seção 27 do briefing
-- original). Guardado em frames.settings, igual ao nome do quadro.
-- (settings já existe desde a migration 003, não precisa de coluna nova)

-- Cada foto no array `photos` ganha um campo opcional `crop`:
--   { "x": 50, "y": 50, "zoom": 1 }
-- x/y são o object-position em porcentagem (onde o "foco" da foto fica
-- dentro do slot quando fit=cover); zoom vai de 1 a 3. Não precisa de
-- migração de dados: fotos antigas sem `crop` assumem o padrão centralizado
-- (o código já trata isso com fallback, não é preciso escrever nada aqui).
