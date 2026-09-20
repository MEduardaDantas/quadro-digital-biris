// Gera um QR Code (PNG) pra URL de acesso de um quadro — o que vai
// colado atrás do porta-retrato físico.
//
// Uso:
//   node src/generate-qr.js https://seu-dominio.com/q/SEU_TOKEN
//
// Salva em backend/frame-qr.png (5cm x 5cm em 300dpi, dá pra imprimir).

const QRCode = require("qrcode");

const url = process.argv[2];
if (!url) {
  console.error("Uso: node src/generate-qr.js <url-completa-do-quadro>");
  console.error("Exemplo: node src/generate-qr.js https://meudominio.com/q/abc123");
  process.exit(1);
}

const outputPath = "frame-qr.png";

QRCode.toFile(outputPath, url, { width: 600, margin: 2 }, (err) => {
  if (err) {
    console.error("Falha ao gerar o QR Code:", err);
    process.exit(1);
  }
  console.log(`QR Code salvo em ${outputPath}`);
  console.log(`Aponta para: ${url}`);
});
