# Quadro Digital de Fotos — Backend

Node.js + Express + PostgreSQL + WebSocket (`ws`). Armazenamento de fotos em
disco local, isolado em `src/storage.js` para trocar por object storage
depois sem tocar no resto do código.

## Arquivos

```
backend/
├── package.json
├── .env.example
├── migrations/
│   ├── 001_init.sql              schema original: frames, current_state, sessions
│   ├── 002_composition_array.sql composição vira array (até 8 fotos) + orientação + device_status
│   └── 003_album_settings_device_info.sql  álbum, configurações remotas, info do dispositivo
├── src/
│   ├── server.js            Express + WebSocket no mesmo servidor HTTP
│   ├── db.js                 pool de conexão Postgres
│   ├── storage.js             armazenamento local em disco, por id de foto + álbum
│   ├── rateLimit.js            limite de tentativas de login
│   ├── wsHub.js                 registro de conexões WS por frame + broadcast
│   ├── migrate.js                roda as migrations (idempotente — ver seção abaixo)
│   ├── seed.js                    cria o frame de teste "demo-frame" (só dev — trava em NODE_ENV=production)
│   ├── create-frame.js             cria um quadro de verdade, com token/senha aleatórios (produção)
│   ├── generate-qr.js               gera o PNG do QR Code a partir de uma URL
│   ├── middleware/session.js       valida Authorization: Bearer <token>
│   └── routes/
│       ├── auth.js            GET /q/:token, login, logout
│       ├── frame.js            current state, foto, publications, status, álbum, configurações
│       └── device.js            endpoints do dispositivo + ack de versão + like
└── uploads/                 fotos publicadas e álbum (runtime, git-ignorado)
```

## Migrations

`npm run migrate` rastreia o que já foi aplicado numa tabela
`schema_migrations` — rodar o comando de novo é seguro, só aplica o que
ainda não rodou (bug de idempotência encontrado e corrigido durante o
desenvolvimento).

## 1. Banco de dados

```bash
sudo apt-get install postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb quadro_digital
```

## 2. Configuração

```bash
cd backend
cp .env.example .env
```

## 3. Instalar, migrar, semear

```bash
npm install
npm run migrate
npm run seed
```

```
token: demo-frame
senha: 1234   (apenas desenvolvimento)
```

## 4. Rodar

```bash
npm run dev
```

## Indo pra produção

`npm run seed` é só pra desenvolvimento local — sempre cria o mesmo
`demo-frame`/`1234`, e se recusa a rodar com `NODE_ENV=production`. Pra
um quadro de verdade, com token e senha próprios (nunca expostos no
código):

```bash
npm run create-frame
# ou, escolhendo você mesmo os valores:
FRAME_TOKEN=seu-token FRAME_PASSWORD=sua-senha npm run create-frame
```

Depois, gere o QR Code físico:

```bash
node src/generate-qr.js https://seu-dominio.com/q/SEU_TOKEN
```

Passo a passo completo de deploy (VPS, Nginx, HTTPS, manter tudo
rodando) em `../DEPLOY.md`.

## Modelo de composição (mudou nesta versão)

Antes: 3 colunas fixas (`slot1_path`, `slot2_path`, `slot3_path`).

Agora: `current_state.photos` é um array JSONB de até 8 itens, cada um com
`id` estável, `path`, `mime`, `fit` (`contain`/`cover`). Existe também
`current_state.orientation` (`landscape`/`portrait`).

A migration `002_composition_array.sql` converte os dados antigos
automaticamente — nenhuma foto publicada antes se perde.

## Endpoints

| Método | Caminho | Uso |
|---|---|---|
| GET | `/q/:token` | localizar o quadro pelo QR Code |
| POST | `/api/v1/auth/login` | autenticar a pessoa |
| POST | `/api/v1/auth/logout` | encerrar sessão |
| GET | `/api/v1/frame/current` | composição atual: `{version, orientation, photos:[{id,url,fit}]}` |
| GET | `/api/v1/frame/current/photos/:id` | baixar uma foto (autenticado) |
| GET | `/api/v1/frame/status` | **novo** — `{online, published_version, device_version, last_seen_at, sync_state, battery_pct, storage_used_mb, storage_total_mb}` |
| POST | `/api/v1/frame/publications` | publicar nova composição (multipart) |
| GET | `/api/v1/frame/album` | **novo** — lista o álbum: `{photos, count, limit}` |
| GET | `/api/v1/frame/album/:id/photo` | **novo** — baixar uma foto do álbum |
| DELETE | `/api/v1/frame/album/:id` | **novo** — remover do álbum |
| POST | `/api/v1/frame/current/photos/:id/like` | **novo** — favoritar uma foto da composição atual |
| GET / PUT | `/api/v1/frame/settings` | **novo** — nome do quadro + configurações de slideshow |
| GET | `/api/v1/device/current` | composição atual (dispositivo, via `?frame_token=`) |
| GET | `/api/v1/device/current/photos/:id` | baixar foto (dispositivo) |
| POST | `/api/v1/device/ack` | dispositivo confirma `{frame_token, version, battery_pct?, storage_used_mb?, storage_total_mb?}` |
| POST | `/api/v1/device/like` | **novo** — dispositivo reporta toque-pra-favoritar `{frame_token, photo_id, liked}` |
| WS | `/api/v1/device/ws` | canal de eventos do dispositivo |

## Formato do manifest de publicação

```json
{
  "base_version": 5,
  "orientation": "landscape",
  "photos": [
    { "action": "keep", "id": "<uuid de uma foto já publicada>", "fit": "cover" },
    { "action": "new", "temp_key": "p1", "fit": "contain" }
  ]
}
```

Para cada item com `action: "new"`, o arquivo correspondente vai anexado no
campo `photo_<temp_key>` do multipart (ex: `photo_p1`). Fotos que não
aparecem no array simplesmente saem da composição — não precisa de um
"clear" explícito, e os arquivos delas são removidos do disco (sem
histórico, como definido desde o início do projeto).

## Testado (ver histórico de desenvolvimento)

- `keep` preservando bytes idênticos do arquivo original;
- `new` com validação por magic bytes;
- remoção automática (garbage collection) de fotos que saíram da composição;
- limite de 8 fotos rejeitado com 400;
- `keep` de um id inexistente rejeitado sem afetar a versão publicada;
- `POST /api/v1/device/ack` atualizando `device_status`, refletido em
  `GET /api/v1/frame/status` (online/offline, versão do dispositivo,
  `sync_state`);
- álbum sobrevivendo a uma publicação que remove a foto da composição
  (seção 15 do briefing), limite de 50 rejeitando a 51ª foto com 409;
- `POST /api/v1/device/like` com `liked:true`/`liked:false`, incluindo
  "unlike" de algo que não estava favoritado (404 correto);
  configurações persistindo entre reloads.

Lista completa de testes em `../README.md`, seção 7.

## Decisões tomadas

- **Concorrência**: última publicação aceita vence (como definido desde o
  início). `base_version` é aceito e guardado, não bloqueia a publicação.
- **Identificação do dispositivo**: o quadro se identifica com o próprio
  `frame_token` — simplificação intencional documentada desde a v1.
- **Validação de imagem**: magic bytes (JPEG/PNG/WebP), não confia em
  extensão nem `Content-Type` declarado.
- **`sync_state`**: `unknown` até o dispositivo confirmar a primeira versão
  via `/device/ack`; depois disso, `updated` (`device_version == published`),
  `syncing` (online mas ainda não bateu) ou `outdated` (offline e atrasado).

## O que NÃO foi implementado (e por quê)

Ver `../README.md`, seção 6 ("Funcionalidades intencionalmente FORA desta
etapa"). Resumo: pipeline de BMP pré-renderizado, slideshow controlado de
fato pelo dispositivo real (o campo existe e é salvo, mas nenhum
dispositivo aplica ainda), e PIN separado do token do QR. Álbum,
like/unlike e informações do dispositivo **foram** implementados — ver
tabela de endpoints acima.
