# Colocando no ar

Três caminhos, do mais barato ao mais no controle:

- **Caminho gratuito** (o deste guia principal): Koyeb (backend) + Neon
  (banco Postgres) + GitHub Pages (site) — R$ 0/mês, sem cartão de
  crédito. É o que você pediu, então é o detalhado abaixo.
- **Caminho pago simples**: um VPS pequeno (~R$25–35/mês) com tudo num
  domínio só — mais previsível, sem as limitações do plano grátis (ver
  seção "Caminho avançado" no fim deste arquivo).
- Railway **não** entra como opção grátis aqui — testei e o plano
  gratuito dele é só um crédito de teste de um mês, não dá pra manter
  algo no ar de graça depois disso (se você viu essa recomendação numa
  resposta anterior minha, estava errada — peço desculpas).

---

## Caminho gratuito: Koyeb (backend) + Neon (banco) + GitHub Pages (site)

### Por que não dá pra usar só o GitHub Pages

O GitHub Pages serve **só arquivos estáticos** (HTML/CSS/JS) — não roda
Node.js, não roda Postgres, não mantém conexão WebSocket aberta. Ele
hospeda o `quadro-web` (o site), mas não o `backend`. Por isso são 3
serviços: Neon guarda os dados, Koyeb roda o backend, GitHub Pages serve
o site.

### A única limitação real deste caminho — seja honesto consigo mesmo sobre isso

Hospedagem gratuita de container **não** costuma incluir disco
permanente (isso vale pra Koyeb, Render, Fly.io — é assim em praticamente
todo mundo, não é falha específica de nenhum). Isso significa que as
**fotos publicadas ficam guardadas no disco do servidor, e esse disco
pode ser resetado** quando o Koyeb reinicia ou reagenda o serviço (o que
pode acontecer sem aviso, de vez em quando, mesmo sem você fazer nada).
O **banco de dados não é afetado** (token, senha, nome do quadro,
álbum favoritado como referência — tudo isso fica seguro no Neon) — só
os arquivos de imagem em si é que podem sumir do disco do Koyeb.

Na prática: pra um presente pessoal, isso costuma significar "de vez em
quando preciso publicar as fotos de novo". Incômodo, mas não é perda de
dados grave, e não custa nada. Se isso incomodar demais depois, me avise
— dá pra eu integrar um armazenamento de arquivos também gratuito (ex:
Cloudflare R2, 10GB grátis) que resolveria isso de vez; não fiz isso
agora pra não aumentar a complexidade do primeiro deploy.

### 1. Colocar o código no GitHub

```bash
cd quadro-digital
git init
git add .
git commit -m "primeira versão"
# crie um repositório no github.com (pode ser privado), depois:
git remote add origin https://github.com/SEU_USUARIO/quadro-digital.git
git push -u origin main
```

### 2. Banco de dados no Neon (grátis pra sempre, sem cartão)

1. Crie conta em [neon.tech](https://neon.tech) (dá pra entrar com GitHub).
2. **Create a project** — dê um nome, escolha uma região.
3. Na tela do projeto, copie a **Connection string** (algo como `postgresql://usuario:senha@ep-xxxx.neon.tech/neondb?sslmode=require`) — essa é a sua `DATABASE_URL`. Guarde ela.

### 3. Rodar as migrations e criar o quadro — direto da sua máquina

Como o Neon é acessível de qualquer lugar pela internet, você não
precisa nem esperar o backend estar no ar pra fazer isso — roda local,
contra o banco remoto:

```bash
cd backend
cp .env.example .env
# edite o .env e troque DATABASE_URL pela connection string do Neon
npm install
npm run migrate
npm run create-frame
```

Anote o token e a senha que aparecerem — nunca mais são mostrados de
novo (é a mesma explicação de antes, agora rodando contra o banco real).

### 4. Backend no Koyeb (grátis, sem cartão na maioria dos casos)

1. Crie conta em [koyeb.com](https://www.koyeb.com) com GitHub.
2. **Create Service → GitHub**, escolha o repositório `quadro-digital`.
3. Em **Builder**, defina o **Work directory** (ou "Root directory", o nome exato varia) como `backend` — é um monorepo, o Koyeb precisa saber onde está o `package.json` certo.
4. Em **Environment variables**, adicione:
   ```
   DATABASE_URL=<a connection string do Neon>
   NODE_ENV=production
   CORS_ORIGIN=https://SEU_USUARIO.github.io
   SESSION_TTL_DAYS=30
   MAX_UPLOAD_MB=10
   ```
5. Confirme que o plano/instância selecionada é a **Free** (0.1 vCPU / 512MB).
6. Deploy. Depois de pronto, o Koyeb te dá uma URL pública tipo `https://quadro-digital-SEUNOME.koyeb.app` — **anote essa URL**, é o seu backend.

> O serviço gratuito do Koyeb pode "dormir" depois de um tempo sem uso e
> acordar em alguns segundos na primeira requisição depois disso — o
> `frame-client` já foi construído pra tolerar exatamente esse tipo de
> desconexão/reconexão, então isso não quebra nada, só pode atrasar a
> primeira sincronização depois de um tempo parado.

### 5. Site no GitHub Pages

1. Antes de subir, edite `quadro-web/config.js` e aponte pro backend do Koyeb:
   ```js
   window.QUADRO_API_BASE_URL = "https://quadro-digital-SEUNOME.koyeb.app";
   ```
   Suba essa mudança: `git add quadro-web/config.js && git commit -m "config produção" && git push`.
2. No GitHub, **Settings → Pages** do repositório → publicar a partir da pasta `quadro-web` (ou mova esses arquivos pra uma pasta `docs/` na raiz, que o GitHub Pages entende sem precisar de Actions).
3. Depois de alguns minutos, o site fica em `https://SEU_USUARIO.github.io/quadro-digital/`.

### 6. A URL do QR Code neste caminho é diferente

O GitHub Pages não sabe reescrever `/q/SEU_TOKEN` pra carregar o
`index.html` (isso é coisa de servidor de verdade fazendo, como o Nginx
do caminho avançado). Sem essa reescrita, `/q/SEU_TOKEN` daria 404. Por
isso, **use o formato com `?frame=` em vez de `/q/`**, já suportado
pelo app exatamente pra esse caso:

```
https://SEU_USUARIO.github.io/quadro-digital/?frame=SEU_TOKEN
```

Gere o QR Code apontando pra essa URL:

```bash
cd backend
node src/generate-qr.js "https://SEU_USUARIO.github.io/quadro-digital/?frame=SEU_TOKEN"
```

### 7. Sincronizar o dispositivo (frame-client)

```bash
cd frame-client
npm install
FRAME_TOKEN=SEU_TOKEN \
BACKEND_HTTP_URL=https://quadro-digital-SEUNOME.koyeb.app \
BACKEND_WS_URL=wss://quadro-digital-SEUNOME.koyeb.app/api/v1/device/ws \
npm start
```

Rode isso no computador que vai ficar conectado ao porta-retrato físico
(ver `frame-client/README.md` sobre a fronteira com o hardware real).
Publique uma foto pelo site e veja aparecer no log — é assim que você
confirma que "reconheceu o dispositivo".

---

## Caminho avançado: um VPS só seu

Rodando Postgres + backend + servindo a interface web tudo num único
servidor, atrás de HTTPS num domínio só. Mais barato por mês
(~R$25–35 em provedores como Hetzner, DigitalOcean ou Contabo), mas
você mesmo cuida de manter o servidor no ar.

---

## 1. Provisionar o servidor

Qualquer VPS Ubuntu 22.04+ com pelo menos 1 GB de RAM serve. Depois de
criar e acessar por SSH:

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm postgresql postgresql-contrib nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

## 2. Banco de dados

```bash
sudo -u postgres psql -c "CREATE USER quadro WITH PASSWORD 'escolha_uma_senha_forte_aqui';"
sudo -u postgres psql -c "CREATE DATABASE quadro_digital OWNER quadro;"
```

## 3. Levar o código pro servidor

```bash
# na sua máquina, dentro da pasta do projeto:
scp -r backend quadro-web frame-client usuario@SEU_SERVIDOR:/opt/quadro-digital/
# ou: clone de um repositório git privado, se você versionar o projeto
```

## 4. Configurar o `.env` — segredos nunca no código

```bash
cd /opt/quadro-digital/backend
cp .env.example .env
nano .env
```

Preencha assim (esse arquivo **nunca** deve ir pro git — o
`.gitignore` do projeto já ignora `.env`, só confirme que você não
está commitando ele manualmente):

```
PORT=3000
DATABASE_URL=postgres://quadro:escolha_uma_senha_forte_aqui@localhost:5432/quadro_digital
UPLOADS_DIR=./uploads
SESSION_TTL_DAYS=30
CORS_ORIGIN=https://SEU_DOMINIO
MAX_UPLOAD_MB=10
NODE_ENV=production
```

`NODE_ENV=production` é importante: ele trava o `npm run seed` (que
cria o quadro de demonstração com senha "1234") pra não rodar sem
querer contra o banco de produção.

## 5. Instalar, migrar, criar o quadro de verdade

```bash
npm install
npm run migrate
npm run create-frame
```

Isso mostra **uma vez só** o token (vai na URL/QR Code) e a senha (PIN
que você digita depois de escanear). Anote os dois agora — só o hash da
senha fica salvo, não tem como recuperar o valor original depois (só
trocar por outro, repetindo esse processo com um token novo, ou veja a
seção 8 abaixo pra trocar sem perder o quadro).

Se quiser escolher você mesmo o token/senha em vez de gerar aleatório:

```bash
FRAME_TOKEN=seu-token-proprio FRAME_PASSWORD=123456 npm run create-frame
```

## 6. Rodar o backend permanentemente (pm2)

```bash
pm2 start src/server.js --name quadro-backend
pm2 save
pm2 startup   # segue as instruções que aparecerem, pra sobreviver a reboot
```

## 7. Nginx — servir o site e encaminhar a API, tudo no mesmo domínio

```nginx
# /etc/nginx/sites-available/quadro-digital
server {
    listen 80;
    server_name SEU_DOMINIO;

    root /opt/quadro-digital/quadro-web;
    index index.html;

    # a interface web (arquivos estáticos)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API HTTP
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # identificação do quadro pelo QR Code
    location /q/ {
        try_files $uri /index.html;
    }

    # WebSocket do dispositivo
    location /api/v1/device/ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/quadro-digital /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Com isso, o frontend não precisa mais do parâmetro `?api=` — ele já
detecta que está na mesma origem do backend automaticamente (isso já
está pronto no `app.js`).

## 8. HTTPS (obrigatório — sem isso o navegador bloqueia câmera/QR e o
   WebSocket seguro não funciona)

```bash
sudo certbot --nginx -d SEU_DOMINIO
```

O certbot já ajusta o Nginx pra redirecionar HTTP → HTTPS e renova
sozinho.

## 9. Gerar o QR Code físico

```bash
cd /opt/quadro-digital/backend
node src/generate-qr.js https://SEU_DOMINIO/q/SEU_TOKEN
```

Isso salva `frame-qr.png` — imprima e cole atrás do porta-retrato.

## 10. "Sincronizar" o dispositivo

Isso é literalmente rodar o `frame-client` apontando pro seu domínio em
vez de `localhost`:

```bash
cd frame-client
npm install
FRAME_TOKEN=SEU_TOKEN \
BACKEND_HTTP_URL=https://SEU_DOMINIO \
BACKEND_WS_URL=wss://SEU_DOMINIO/api/v1/device/ws \
npm start
```

Rodando isso no computador que vai ficar conectado ao porta-retrato
físico (ou, futuramente, no próprio hardware — ver `frame-client/README.md`
sobre essa fronteira), ele conecta, se identifica, baixa o estado atual
e fica esperando eventos. Publique algo pelo site e veja aparecer no log
dele — é assim que você confirma que "reconheceu o dispositivo".

Pra manter isso rodando sempre (não só numa sessão de terminal aberta):

```bash
pm2 start client.js --name quadro-frame-client --cwd /opt/quadro-digital/frame-client \
  --env FRAME_TOKEN=SEU_TOKEN,BACKEND_HTTP_URL=https://SEU_DOMINIO,BACKEND_WS_URL=wss://SEU_DOMINIO/api/v1/device/ws
pm2 save
```

## 11. Se o token ou a senha vazarem

Não existe um endpoint de "trocar senha" ainda — pra revogar acesso:

```sql
-- conectado no Postgres de produção
UPDATE frames SET password_hash = '<novo hash bcrypt>' WHERE token = 'SEU_TOKEN';
```

Gerar um novo hash rapidamente:

```bash
node -e "require('bcrypt').hash('nova_senha', 10).then(console.log)"
```

Isso muda só a senha, mantendo o mesmo token (e portanto o mesmo QR
Code já impresso). Se o **token** vazar (não só a senha), aí sim
precisa trocar o QR físico: crie um quadro novo com `create-frame` e
mova a composição manualmente, ou me avise que dá pra eu implementar um
endpoint de "trocar token" — hoje isso só é possível direto no banco.

## Checklist rápido antes de considerar "no ar"

- [ ] `.env` tem uma senha de banco forte, não a de exemplo
- [ ] `NODE_ENV=production` está definido
- [ ] `npm run create-frame` rodou (não `npm run seed`) — confirme que
      o token NÃO é `demo-frame` nem a senha `1234`
- [ ] HTTPS ativo (certbot) — teste acessando com `https://`
- [ ] `CORS_ORIGIN` no `.env` bate exatamente com o domínio usado
- [ ] `pm2 save` + `pm2 startup` rodados, pra sobreviver a um reboot do
      servidor
- [ ] QR Code gerado aponta pra URL `https://` (não `http://`)
