// Armazenamento local em disco para o MVP.
// Todo acesso a arquivo do sistema passa por aqui, então trocar para
// object storage (S3, etc.) depois é só reescrever este arquivo.
//
// Cada foto vira um arquivo próprio identificado por um id estável
// (não mais por posição/slot fixo, já que a composição agora é uma
// lista de tamanho variável — remover/reordenar não deve exigir
// renomear arquivos de outras fotos).

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || "./uploads");

function frameDir(frameId) {
  return path.join(UPLOADS_DIR, frameId, "current");
}

function tmpDir() {
  const dir = path.join(UPLOADS_DIR, "_tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureFrameDir(frameId) {
  const dir = frameDir(frameId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extFromMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

// Move um arquivo temporário (já validado) para a posição final,
// nomeado pelo id estável da foto.
function commitPhotoFile(frameId, photoId, tempFilePath, mime) {
  const dir = ensureFrameDir(frameId);
  const finalPath = path.join(dir, `photo-${photoId}.${extFromMime(mime)}`);
  fs.renameSync(tempFilePath, finalPath);
  return finalPath;
}

// Copia (não move) um arquivo já existente — usado quando o usuário escolhe
// uma foto do ÁLBUM para entrar na composição: o arquivo do álbum precisa
// continuar existindo lá, então a composição ganha sua própria cópia.
function copyIntoComposition(frameId, photoId, sourcePath, mime) {
  const dir = ensureFrameDir(frameId);
  const finalPath = path.join(dir, `photo-${photoId}.${extFromMime(mime)}`);
  fs.copyFileSync(sourcePath, finalPath);
  return finalPath;
}

// Remove os arquivos de fotos que não fazem mais parte da composição
// (a composição não mantém histórico — o que sai, sai de vez).
function garbageCollectPhotos(frameId, keepPaths) {
  const dir = frameDir(frameId);
  if (!fs.existsSync(dir)) return;
  const keep = new Set(keepPaths.map((p) => path.resolve(p)));
  for (const file of fs.readdirSync(dir)) {
    const full = path.resolve(path.join(dir, file));
    if (!keep.has(full)) fs.unlinkSync(full);
  }
}

// --- Álbum: arquivos independentes do ciclo de vida da composição ---

function albumDir(frameId) {
  const dir = path.join(UPLOADS_DIR, frameId, "album");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Copia (não move) o arquivo de uma foto da composição pro álbum, com um
// id próprio — assim a foto sobrevive mesmo que a composição garbage
// colete o arquivo original numa publicação futura.
function copyToAlbum(frameId, sourcePath, mime) {
  const dir = albumDir(frameId);
  const albumId = uuidv4();
  const finalPath = path.join(dir, `album-${albumId}.${extFromMime(mime)}`);
  fs.copyFileSync(sourcePath, finalPath);
  return { id: albumId, path: finalPath };
}

function deleteAlbumFile(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function fileExists(filePath) {
  return !!filePath && fs.existsSync(filePath);
}

module.exports = {
  UPLOADS_DIR,
  tmpDir,
  frameDir,
  ensureFrameDir,
  commitPhotoFile,
  copyIntoComposition,
  garbageCollectPhotos,
  fileExists,
  extFromMime,
  copyToAlbum,
  deleteAlbumFile,
};
