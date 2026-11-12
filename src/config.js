import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));

export const config = {
  port: Number(process.env.PORT || 3000),
  // URL pública (ex.: https://catalogo.usemiz.com). Se vazio, usa o host da requisição.
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 1024),
  // Tamanho (px) do lado maior de cada página gerada. 3200 px = nítido em telas Retina, inclusive com zoom.
  pageSize: Number(process.env.PAGE_SIZE || 3200),
  // Qualidade WebP (1-100). 90 = visualmente idêntico ao PDF.
  webpQuality: Number(process.env.WEBP_QUALITY || 90),
  brandName: process.env.BRAND_NAME || "MIZ",
};

export const paths = {
  users: path.join(DATA_DIR, "users.json"),
  catalogs: path.join(DATA_DIR, "catalogs.json"),
  secret: path.join(DATA_DIR, "secret.key"),
  media: path.join(DATA_DIR, "media"),
  originals: path.join(DATA_DIR, "originals"),
  tmp: path.join(DATA_DIR, "tmp"),
  seedUsers: path.join(ROOT_DIR, "config", "seed-users.json"),
  public: path.join(ROOT_DIR, "public"),
};
