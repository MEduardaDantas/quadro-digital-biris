# Quadro Digital de Fotos — Portal Web

> **Indo colocar no ar?** Pule direto pro `DEPLOY.md` — tem o passo a
> passo de servidor, HTTPS, criar um quadro de verdade (sem senha fixa
> no código) e conectar o `frame-client` na produção.

## 1. Resumo da arquitetura encontrada (auditoria)

O projeto já tinha: backend (Express + Postgres + WebSocket), interface web
integrada de verdade (sem mocks), e um simulador de dispositivo. Isso foi
preservado e evoluído, não reescrito.

O que o briefing novo assumia existir e **não existia**: modelo de Álbum,
Like/Unlike, Slideshow refletido no portal, informações de
bateria/storage do dispositivo, pipeline de BMP pré-renderizado, e as
estruturas `PersistedState`/`Photo` (`composition[8]`, `album[50]`,
`persisted`, `inUse`) — nenhuma dessas existe em código nenhum do projeto.
Ver seção 6 abaixo para o que isso implica.

## 2. Arquivos alterados

```
backend/migrations/002_composition_array.sql   NOVO — schema
backend/src/storage.js                          reescrito (fotos por id, não por slot)
backend/src/routes/frame.js                      reescrito (composição array, fit, orientação, /status)
backend/src/routes/device.js                      reescrito (idem) + /device/ack NOVO
frame-client/client.js                             reescrito (N fotos, ack, limite de exibição documentado)
quadro-web/index.html                               reescrito (containers dinâmicos)
quadro-web/style.css                                 + status pills, toggle de orientação, lista de fotos
quadro-web/app.js                                     reescrito (editor dinâmico, fit, orientação, status)
*/README.md                                           atualizados
```

Não alterados (continuam como estavam): `backend/src/server.js`,
`backend/src/db.js`, `backend/src/rateLimit.js`, `backend/src/wsHub.js`,
`backend/src/middleware/session.js`, `backend/src/routes/auth.js`,
`quadro-web/server.py`.

## 3. Funcionalidades implementadas nesta etapa

**Rodada 1 (composição):**
- **Composição de 1 a 8 fotos** (era fixa em 3) — adicionar, remover,
  reordenar (↑/↓).
- **Fit por foto**: Conter (`contain`) / Preencher (`cover`).
- **Orientação** Horizontal (800×480) / Vertical (480×800) — o layout é
  recalculado (linha ↔ coluna), não é uma rotação das fotos.
- **Rascunho vs Publicado** com indicação visual clara (badge).
- **Status do dispositivo**: online/offline (WebSocket real), versão
  publicada vs versão confirmada pelo dispositivo, com os estados
  atualizado / sincronizando / desatualizado.

**Rodada 2 (álbum, like, configurações, info do dispositivo):**
- **Álbum de favoritos**: até 50 fotos, independente da composição —
  favoritar uma foto copia o arquivo pra um armazenamento à parte, então
  ela sobrevive mesmo depois de sair da composição publicada (testado:
  seção 15 do briefing). Mensagem "Álbum cheio..." quando atinge o limite.
  Remover do álbum só existe no portal (seção 16 — o dispositivo não tem
  como selecionar thumbnail).
- **Like/Unlike**: endpoint que tanto o portal quanto o dispositivo podem
  chamar (`POST /api/v1/frame/current/photos/:id/like` no portal,
  `POST /api/v1/device/like` no dispositivo) — o coração no editor reflete
  o estado real do álbum.
- **Configurações remotas**: nome do quadro e parâmetros de slideshow
  (ativado/desativado, duração), persistidos e recarregados corretamente.
- **Informações do dispositivo**: bateria e armazenamento — mostrados como
  **N/A** porque nenhum dispositivo real os reporta ainda (não inventamos
  valor nenhum, como a seção 20 exige). O canal (`/device/ack` aceita esses
  campos opcionalmente) já existe pronto pra quando o hardware real tiver
  como medir isso.

**Rodada 5 (identidade visual + escolher do álbum):**
- Nome do app trocado para "Meu Quadro Biris" em todo lugar (título da
  aba, nav, login).
- Ícone/mascote fofo (uma carinha sorridente dentro de uma moldura
  dourada) — usado como favicon e como decoração ao lado do nome em
  vários pontos.
- Mais decoração visual preenchendo o espaço vazio das páginas:
  silhuetas grandes e suaves do mascote nos cantos, estrelinhas/corações
  flutuando pela tela (bem discretos, atrás de todo o conteúdo).
- **Escolher foto do álbum pra composição**: agora dá pra montar o quadro
  não só enviando foto nova do dispositivo, mas também escolhendo entre
  as que já estão favoritadas no álbum — sem precisar re-enviar o
  arquivo. Testado publicando uma composição inteira feita só com fotos
  vindas do álbum.

**Rodada 6 (produção — segredos, deploy, QR Code):**
- `backend/src/create-frame.js` — cria um quadro de verdade com token
  longo e PIN aleatórios (ou escolhidos via env var), hash bcrypt no
  banco, nunca em texto puro em lugar nenhum do código.
- `backend/src/seed.js` agora se recusa a rodar com
  `NODE_ENV=production` — evita criar o `demo-frame`/`1234` sem querer
  num banco real.
- `backend/src/generate-qr.js` — gera o PNG do QR Code a partir da URL
  final do quadro.
- Frontend: `API_BASE_URL` agora usa a mesma origem do portal por
  padrão em produção (sem precisar do parâmetro `?api=` na URL do QR
  Code); em desenvolvimento local continua caindo pro backend em
  `localhost:3000` automaticamente.
- `DEPLOY.md` novo — passo a passo completo de VPS, Nginx, HTTPS e como
  "sincronizar" o `frame-client` apontando pra produção.

## 4. Funcionalidades que já existiam e foram preservadas

Login com QR (`/q/{token}`) + senha (PIN) + sessão de ~30 dias, rate
limiting de tentativas, publicação atômica com transação e rollback,
validação de imagem por magic bytes (não por extensão), WebSocket com
`PHOTO_UPDATED`, comportamento offline-first do dispositivo (mostra a
última composição conhecida, reconecta e sincroniza sozinho).

## 5. Mudanças de protocolo/API

**Rodada 5:**
- `POST /api/v1/frame/publications`: nova ação de manifest
  `"from_album"` — `{ action: "from_album", album_id, fit, crop }`. O
  backend copia o arquivo do álbum pra dentro da composição com um id
  novo (o arquivo do álbum continua existindo, intacto, independente).
- `storage.js` ganhou `copyIntoComposition()` (cópia, não move — igual ao
  padrão já usado por `copyToAlbum()`, só que na direção contrária).

**Rodada 1:**
- `current_state`: colunas fixas `slot1_path/slot2_path/slot3_path` →
  coluna única `photos` (array JSONB, até 8 itens `{id, path, mime, fit}`)
  + coluna `orientation`. Migration converte dados existentes automaticamente.
- `GET /api/v1/frame/current` e `/device/current`: `slots: {1,2,3}` →
  `photos: [...]`, mais o campo `orientation`.
- Endpoints de foto: `/slots/{1,2,3}` → `/photos/{id}` (por id, não posição).
- `POST /api/v1/frame/publications`: manifest mudou de
  `{slots: {"1": {action}}}` para `{orientation, photos: [{action: "keep"|"new", ...}]}`.
  `clear` deixou de existir como ação — remover uma foto é simplesmente
  não incluí-la na lista publicada.
- **Novo** `POST /api/v1/device/ack` e `GET /api/v1/frame/status`.

**Rodada 2:**
- **Nova tabela** `album_photos` (frame_id, path, mime, source_photo_id,
  added_at) — arquivo próprio por foto do álbum, independente do ciclo
  de vida da composição.
- **Novas colunas** em `frames`: `device_name`, `settings` (jsonb).
- **Novas colunas** em `device_status`: `battery_pct`, `storage_used_mb`,
  `storage_total_mb` — preenchidas só se o dispositivo enviar.
- **Novos endpoints**: `GET/DELETE /api/v1/frame/album`,
  `GET /api/v1/frame/album/:id/photo`,
  `POST /api/v1/frame/current/photos/:id/like`,
  `GET/PUT /api/v1/frame/settings`, `POST /api/v1/device/like`.
- `POST /api/v1/device/ack` ganhou campos opcionais
  (`battery_pct`, `storage_used_mb`, `storage_total_mb`).
- Corrigido também: `backend/src/migrate.js` não tinha controle de
  migrations já aplicadas (rodar `npm run migrate` duas vezes quebrava
  com "column already exists"). Agora há uma tabela `schema_migrations`
  rastreando o que já rodou — bug real encontrado e corrigido nesta etapa,
  não fazia parte do pedido original.

## 6. Funcionalidades intencionalmente FORA desta etapa

Seguindo a seção 30 do briefing ("se não puder implementar sem alterar
protocolo, não faça gambiarra — informe o que mudaria"):

| Funcionalidade | Status | Por que / o que falta |
|---|---|---|
| **Slideshow controlado remotamente de verdade** | Parcial | O portal salva a configuração (`slideshow_enabled`, duração) e ela é persistida — mas nenhum dispositivo real aplica isso ainda, porque o `frame-client` simulador não tem modo slideshow. O campo existe e está pronto; falta o firmware real consumi-lo. |
| **BMP pré-renderizado no backend** | Não feito | Hoje o backend só repassa o arquivo enviado (JPEG/PNG/WebP) como está — não há pipeline de composição de imagem server-side. Isso é uma mudança de arquitetura real (seção 27/28): adicionar uma etapa de processamento (ex: biblioteca `sharp`) que gera o bitmap final já no fit/orientação certos no momento da publicação, e o dispositivo passaria a baixar esse arquivo pronto em vez de decodificar JPEG/PNG/WebP. Não fiz isso porque (a) é uma mudança grande o bastante pra merecer sua própria etapa, e (b) sem saber o formato BMP exato que o hardware real espera (paleta, header, orientação de bytes), qualquer implementação seria adivinhação — exatamente o tipo de "gambiarra" que a seção 30 pede pra evitar. |
| **PIN separado de token longo** | Não feito | O sistema já usa senha curta (`1234`) como PIN — funcionalmente equivalente ao que a seção 21 descreve. Só mudaria se o requisito for literalmente dois segredos distintos, o que não ficou claro ser necessário. |

## 7. Testes executados

Todos rodados de verdade nesta sessão (Postgres real, backend real,
navegador real via Puppeteer, `frame-client` real) — não é só leitura de
código:

- **Composição**: publicar com `keep` preservando bytes idênticos do
  arquivo; publicar 8 fotos (limite) e 9 fotos (rejeitado com 400);
  `keep` de um id inexistente rejeitado sem alterar a versão publicada;
  garbage collection removendo do disco só os arquivos que saíram da
  composição.
- **Orientação / Fit**: alternar horizontal/vertical recalcula o layout;
  `cover` publicado chega intacto no dispositivo simulado.
- **Editor dinâmico**: adicionar, reordenar, remover fotos via navegador
  real.
- **Publicação**: rascunho→prévia→confirmar→publicar, versão incrementa,
  badge muda de "Rascunho" pra "Publicado — versão N".
- **Reconexão/offline**: publicar com o dispositivo offline, ele reconecta
  e sincroniza sozinho.
- **Status do dispositivo**: `online:false/sync_state:"unknown"` antes de
  qualquer conexão, `online:true/device_version:N/sync_state:"updated"`
  depois do `frame-client` conectar e confirmar via `/device/ack`.
- **Álbum**: favoritar uma foto pelo portal, ela aparece no álbum;
  publicar uma composição totalmente nova removendo essa foto da
  composição — **confirmado que ela permanece no álbum** (seção 15);
  baixar a foto do álbum e confirmar que são bytes reais; encher o álbum
  até 50 e confirmar rejeição (409) na 51ª; remover do álbun pelo botão
  × no portal e ver o coração da foto correspondente voltar a vazio.
- **Like/Unlike pelo protocolo do dispositivo**: `POST /api/v1/device/like`
  com `liked:true` e `liked:false`, incluindo tentar "unlike" duas vezes
  (segunda vez retorna 404 corretamente).
- **Configurações**: salvar nome do quadro + slideshow, recarregar a
  página, confirmar que persistiu.
- **Informações do dispositivo**: confirmado que aparecem como `N/A`
  quando o dispositivo não reporta bateria/storage (nunca inventado).
- **Sessão**: login errado (401), login certo, logout invalida sessão
  (401 depois), rate limiting.
- **Migrations**: bug de idempotência encontrado e corrigido — rodar
  `npm run migrate` duas vezes agora pula o que já foi aplicado em vez
  de quebrar.

## 8. Comandos para rodar

**Backend:**
```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

**Frontend:**
```bash
cd quadro-web
python3 server.py 8080
```
Acesse `http://localhost:8080/q/demo-frame`, senha `1234`.

**Cliente do quadro (simulador):**
```bash
cd frame-client
npm install
npm start
```

## 9. Comandos para testar

Não há suíte automatizada de testes no repositório entregue (os testes
E2E foram scripts de verificação usados durante o desenvolvimento, não
fazem parte do deliverable). Para testar manualmente, siga o roteiro da
seção 7 acima pela interface web — é o mesmo roteiro que foi executado.

## 10. Como conectar sem depender da internet pública

Hoje **tudo** — celular/portal, backend e `frame-client` — conversa por
HTTP e WebSocket (TCP/IP comum). Vale separar duas situações:

### Já funciona: rede local (Wi-Fi de casa), sem internet pública

HTTP/WebSocket não exigem "internet" no sentido de acesso público — só
exigem que as duas pontas se enxerguem na mesma rede. Se a máquina que
roda o `backend` e a que roda o `frame-client` (ou, no futuro, o
hardware físico) estiverem na mesma rede Wi-Fi/local, basta apontar pro
IP da máquina do backend em vez de `localhost`:

```bash
# descubra o IP da máquina rodando o backend na rede local
hostname -I    # Linux
ipconfig       # Windows (procure "Endereço IPv4")

# no frame-client, em outra máquina da mesma rede:
FRAME_TOKEN=demo-frame \
BACKEND_HTTP_URL=http://192.168.0.42:3000 \
BACKEND_WS_URL=ws://192.168.0.42:3000/api/v1/device/ws \
npm start

# no navegador, pra acessar o portal de outro aparelho na mesma rede:
http://192.168.0.42:8080/q/demo-frame?api=http://192.168.0.42:3000
```

Não precisa expor nada pra internet pública pra isso funcionar — só
precisa que backend, portal e dispositivo estejam na mesma rede local
(ou VPN). O `CORS_ORIGIN` no `.env` do backend precisa bater com a
origem de onde o portal está sendo acessado.

### Ainda não existe: conexão física direta (USB/serial) com o hardware

O hardware original mencionado no início do projeto (BOE 7" / placa
YG-912S-V1.2 / MStar MSB2531A) tem Mini-USB e pontos TXD/RXD — dá pra
imaginar uma conexão serial/USB direta com um computador, sem rede
nenhuma envolvida. **Isso não foi implementado.** O `frame-client` de
hoje só fala HTTP/WebSocket; não tem código pra falar com uma porta
serial ou se comportar como storage USB.

Se a ideia é o quadro físico eventualmente conversar por cabo (sem
depender nem de rede local), isso é um projeto à parte: seria preciso
decidir se o `frame-client` ganha um modo alternativo de transporte
(serial em vez de HTTP) ou se o firmware do próprio dispositivo passa a
rodar um cliente HTTP/WebSocket localmente nele. Nenhuma das duas
existe ainda — é a mesma fronteira "hardware ainda não tocado" já
documentada desde a primeira entrega.

## 11. Limitações restantes

- Hardware físico ainda não tocado — o `frame-client` continua sendo o
  "dispositivo" para todos os efeitos.
- BMP pré-renderizado e slideshow controlado de fato pelo dispositivo real
  não foram implementados — motivo e caminho documentados na seção 6.
- PIN separado do token do QR não foi implementado — já é funcionalmente
  equivalente ao que existe.
- Reordenar fotos no editor é só ↑/↓ (sem drag-and-drop).
- `device_status` assume 1 dispositivo físico por quadro (não há um
  identificador de dispositivo separado do `frame_id`) — correto pro caso
  de uso atual, mas precisaria mudar se um quadro puder ter mais de um
  dispositivo físico conectado simultaneamente.
- O álbum guarda uma cópia própria de cada foto favoritada (por design,
  pra sobreviver à composição) — isso significa que o mesmo arquivo pode
  existir duas vezes em disco (uma na composição, uma no álbum) enquanto
  a foto estiver em ambos. Aceitável pro volume de um projeto pessoal;
  não otimizado para escala.
