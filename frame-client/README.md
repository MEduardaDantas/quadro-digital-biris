# Cliente do Quadro (simulador)

Roda no computador e simula o comportamento do quadro físico, antes de
mexer em hardware (ver seção 19/21 do briefing).

## O que ele faz

1. Ao iniciar, carrega `local/state.json` — o quadro continua mostrando a
   última composição conhecida, mesmo se o backend estiver fora do ar.
2. Conecta via WebSocket e se identifica com `frame_token`.
3. Assim que identificado, consulta o estado atual via HTTPS — cobre o caso
   de ter perdido publicações enquanto estava desligado.
4. Fica escutando `PHOTO_UPDATED`. Ao receber, baixa **todas** as fotos da
   composição (até 8) e salva localmente.
5. **Confirma pro backend** (`POST /api/v1/device/ack`) qual versão aplicou
   — isso não existia antes; sem isso o backend nunca sabia se o
   dispositivo realmente processou o evento ou só recebeu a notificação.
6. Se a conexão cair, tenta reconectar a cada poucos segundos; ao
   reconectar, compara versões de novo.

## Limitação real do hardware (documentada, não escondida)

O modelo de composição suporta até 8 fotos. Este simulador baixa e cacheia
todas elas, mas só **exibe** (loga) as 3 primeiras — porque o hardware
físico atual (a tela BOE 7" / MStar MSB2531A referenciada no projeto) só
tem lógica de desenho pra 3 posições. Isso está isolado numa única
constante (`DISPLAY_LIMIT` em `client.js`) pra ficar óbvio onde mexer
quando o hardware evoluir — o modelo de dados não foi limitado
permanentemente a 3, só a exibição atual.

## Rodando

Com o backend rodando em `http://localhost:3000`:

```bash
cd frame-client
npm install
npm start
```

Por padrão ele usa `frame_token=demo-frame`. Para outro quadro ou outro
host:

```bash
FRAME_TOKEN=abc123 BACKEND_HTTP_URL=http://192.168.0.10:3000 \
BACKEND_WS_URL=ws://192.168.0.10:3000/api/v1/device/ws npm start
```

## Testando o cenário offline

1. Rode o cliente (`npm start`) e deixe conectado.
2. Pare o backend (`Ctrl+C` no terminal dele). No log do cliente você vai
   ver "conexão perdida... tentando reconectar".
3. Suba o backend de novo e publique alguma coisa pela interface web.
4. O cliente reconecta sozinho e sincroniza — sem precisar reiniciar nada.

## Cache local

```
local/
├── state.json         { version, orientation, photos: [{id, filename, fit}] }
├── photo-<id>.jpg
├── photo-<id>.png
└── photo-<id>.webp
```

Esse diretório é git-ignorado — é gerado em runtime e representa o "que o
quadro está exibindo agora".

## Protocolo de like (seção 14) — endpoint existe, simulador não aciona

`POST /api/v1/device/like { frame_token, photo_id, liked }` já está
implementado no backend e testado (ver `../backend/README.md`), pra
quando o dispositivo real detectar o toque numa foto. Este simulador
**não** chama esse endpoint automaticamente, porque ele não tem
touchscreen nem UI nenhuma — simular um toque aleatório seria inventar um
comportamento que não existe. Quando o firmware real tiver a detecção de
toque, é só ele chamar esse mesmo endpoint com o `id` da foto que estava
na tela.
