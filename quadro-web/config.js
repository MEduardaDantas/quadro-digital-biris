// Configuração de produção quando o site e o backend ficam em domínios
// DIFERENTES (ex: site no GitHub Pages, backend no Railway/Render).
//
// Se você seguiu o caminho do DEPLOY.md com um servidor único (Nginx
// servindo tudo no mesmo domínio), deixe isso vazio ("") — o app
// detecta sozinho que backend e frontend estão juntos.
//
// Se o backend está em outro lugar, preencha com a URL completa dele
// (sem barra no final):
//
//   window.QUADRO_API_BASE_URL = "https://seu-backend.up.railway.app";
//
// Assim a URL do QR Code continua limpa (https://seudominio/q/TOKEN),
// sem precisar carregar o endereço do backend dentro dela.

window.QUADRO_API_BASE_URL = "";
