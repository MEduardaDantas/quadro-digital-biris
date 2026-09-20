# Quadro Digital de Fotos — Interface Web

## Identidade visual + escolher do álbum (rodada 5)

- Renomeado para **"Meu Quadro Biris"** em todo lugar.
- Mascote fofo (favicon + decoração ao lado do nome) — uma carinha
  sorridente numa moldura dourada.
- Decoração de fundo preenchendo as páginas: silhuetas grandes do
  mascote nos cantos + estrelinhas/corações flutuando, tudo bem discreto
  atrás do conteúdo.
- **Botão "Escolher do álbum"** ao lado de "Adicionar foto": abre um
  seletor com grade de fotos favoritadas, clique pra marcar/desmarcar,
  respeita o limite de 8 fotos da composição. A foto escolhida vira uma
  cópia independente na composição (não afeta o álbum).

### Bug corrigido nesta rodada (não é o de sempre, é novo)

As decorações de fundo ficaram **invisíveis** na primeira tentativa
porque usei `z-index: -1`. Isso não é a mesma pegadinha do `[hidden]`
(documentada abaixo) — é outra: elemento com `position:fixed`/`absolute`
e `z-index` negativo pode acabar pintado *atrás do próprio fundo da
página*, porque o background do `<body>` vira o "canvas" da página e
esse canvas pinta por baixo de qualquer z-index negativo. A correção foi
simplesmente remover o `z-index: -1` — a ordem desses elementos no HTML
(antes do `#app`) já garante que ficam atrás do conteúdo real, sem
precisar de z-index nenhum.

## Ajustar a foto de verdade (rodada 4)

- **Arrastar dentro da moldura**: com fit "Preencher", a foto vira uma
  `<img>` de verdade com `object-position` controlado por arrastar (mouse,
  via Pointer Events). Roda do mouse ou os botões `−`/`⟳`/`+` (aparecem no
  hover) controlam o zoom (1x–3x). Isso é gravado por foto (`crop: {x, y,
  zoom}`) e **persiste de verdade** no backend — testei publicar, recarregar
  a página, e o zoom/posição continuavam lá.
- **Layouts**: Uniforme (como antes), Destaque (primeira foto maior) e
  Grade (2 colunas), cada um com um mini-diagrama no próprio botão em vez
  de só texto. Faz parte da composição publicada (`layout_template`).
- **Molduras**: Clássica, Madeira, Fina e Polaroid — 4 bordas decorativas
  escolhidas no modal de Configurações, com preview em miniatura. Aplicada
  ao vivo no editor, persiste entre sessões.
- Fotos novas já entram com fit "Preencher" por padrão (é o que libera
  arrastar/zoom — antes vinha em "Conter", que é sempre a imagem inteira,
  sem nada pra ajustar).
- Ícones SVG substituindo texto simples em vários pontos (câmera, coração,
  cadeado, imagem) pra dar mais acabamento visual.

### Limite honesto disso

`layout_template` e o `crop` de cada foto são persistidos no backend e
devolvidos pro dispositivo — mas como não existe pipeline de composição de
imagem no lado do dispositivo ainda (ver seção 6 do `../README.md`), hoje
só o **portal** desenha isso visualmente. O dado está pronto pra quando
existir um pipeline de renderização real (BMP pré-processado ou
equivalente) consumir. As molduras são só do portal mesmo — não fazem
sentido no dispositivo físico, que tem sua própria carcaça.

## Reformulação de UX/visual (rodada 3)

Reestruturado de uma página única com painéis empilhados para um app de
verdade, com navegação e layout responsivo:

- **Nav superior** fixa (Editor / Álbum), com status do dispositivo,
  configurações e sair sempre visíveis.
- **Editor**: layout em duas colunas a partir de 900px — prévia grande e
  destacada à esquerda, lista de fotos à direita (fixa ao rolar). Em
  telas menores, empilha em coluna única.
- **Reordenar fotos**: arrastar com o mouse (desktop) **ou** os botões
  ↑/↓ (funciona em qualquer dispositivo, incluindo touch — HTML5 drag
  nativo não funciona em celular, então os botões continuam sendo o
  caminho garantido).
- **Álbum é uma página própria** (não um painel dentro do editor): grade
  de fotos, clicar abre uma foto grande (lightbox) com zoom (clique
  alterna ampliar/reduzir) e remoção do álbum ali mesmo.
- **Configurações** viraram um modal simples: nome do quadro + informações
  do dispositivo. Slideshow foi removido do portal — é comportamento do
  quadro físico, como apontado.
- Login ganhou uma composição mais decorativa (ilustração do quadro ao
  lado do formulário) em vez de um cartão sozinho no meio do vazio.

Paleta de cores e tipografia (Fraunces + IBM Plex Sans) mantidas como
estavam — só o layout, hierarquia visual e responsividade mudaram.

## Bug de CSS recorrente (aconteceu 3 vezes — atenção aqui)

Toda vez que uma classe/id define `display: flex` ou `display: grid`
diretamente, ela empata em especificidade com a regra padrão do navegador
`[hidden] { display: none }` — e como o CSS do projeto carrega depois da
UA stylesheet, a regra do projeto vence, fazendo o elemento aparecer
mesmo com `hidden` definido. Já aconteceu com `.modal-backdrop`,
`#view-login` e `.hint-line`. Corrigido nos três casos com
`seletor[hidden] { display: none; }` explícito. Fiz uma varredura
completa comparando todo elemento alternado via `.hidden` no JS contra
todo seletor com `display:` no CSS — não sobrou nenhum caso sem essa
proteção. **Se uma nova tela/elemento usar `display: flex` ou `grid` e
também for escondido via `hidden`, adicionar o override `[hidden]` na
hora, não depois.**

## Arquivos

```
quadro-web/
├── index.html
├── style.css
├── app.js
├── config.js
├── server.py
└── README.md
```

## Backend em outro domínio (rodada 6 — deploy)

`config.js` (carregado antes de `app.js`) define
`window.QUADRO_API_BASE_URL`. Deixe vazio (`""`) quando o site e o
backend ficam atrás do mesmo domínio (ex: Nginx reverse proxy) — o app
detecta isso sozinho. Preencha com a URL do backend quando os dois
estiverem em domínios diferentes (ex: site no GitHub Pages, backend no
Railway) — ver `../DEPLOY.md`.

Nesse cenário de domínios diferentes, use `?frame=TOKEN` em vez de
`/q/TOKEN` na URL (o roteamento por `/q/` depende de um servidor que
saiba reescrever a rota pro `index.html`, o que hospedagem 100%
estática como GitHub Pages não faz — `?frame=` já é suportado
especificamente pra esse caso).

## Rodando

Com o backend em `http://localhost:3000`:

```bash
cd quadro-web
python3 server.py 8080
```

`http://localhost:8080/q/demo-frame`, senha `1234`.
Backend em outra porta: `?api=http://host:porta` na URL.

## Testado

Login → editor com 2 colunas em desktop → adicionar 4 fotos → reordenar
pelo botão ↓ → trocar orientação → publicar → navegar pra aba Álbum sem
perder sessão → favoritar/ver/ampliar/remover foto no álbum → voltar pro
editor → configurações (nome do quadro, persistindo após reload). Testado
em viewports de 390px (celular), 820px (tablet) e 1440px (desktop).

**Rodada 4**: arrastar uma foto (Pointer Events, mouse), zoom pelo botão
`+` (2 cliques → `scale(1.4)` confirmado), publicar, recarregar a página
e confirmar que zoom e posição persistiram de verdade (não só no estado
do navegador); trocar entre os 3 layouts e confirmar a classe CSS
correta em cada; trocar entre as 4 molduras e confirmar persistência após
reload; combinação grade + retrato + polaroid renderizando corretamente.

**Rodada 5**: nome "Meu Quadro Biris" confirmado no título da aba, nav e
login; botão "Escolher do álbum" avisa corretamente quando o álbum está
vazio; publicar 2 fotos → favoritar as duas → remover da composição →
escolher as 2 de volta pelo álbum → publicar de novo — tudo com
navegador real, título de cada foto mostrando "(do álbum)" corretamente.
