/**
 * Processo filho que converte um PDF em páginas WebP de alta resolução.
 * Roda separado do servidor para não travar o site durante a conversão.
 *
 * Uso: node convert-worker.js <pdf> <pastaSaida> <ladoMaiorPx> <qualidade>
 * Mensagens enviadas ao pai: {type:"start",total} {type:"page",...} {type:"done"} {type:"error"}
 */
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";
import sharp from "sharp";

const [, , pdfPath, outDir, sizeArg, qualityArg] = process.argv;
const TARGET_SIZE = Number(sizeArg) || 3200; // lado maior da página, em px
const QUALITY = Number(qualityArg) || 90;

sharp.concurrency(1);
sharp.cache(false);

const send = (msg) => process.send && process.send(msg);

async function main() {
  fs.mkdirSync(path.join(outDir, "pages"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "thumbs"), { recursive: true });

  const doc = mupdf.Document.openDocument(fs.readFileSync(pdfPath), "application/pdf");
  const total = doc.countPages();
  if (total === 0) throw new Error("O PDF não tem páginas.");
  send({ type: "start", total });

  for (let i = 0; i < total; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const pw = x1 - x0;
    const ph = y1 - y0;
    const scale = TARGET_SIZE / Math.max(pw, ph);

    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const w = pix.getWidth();
    const h = pix.getHeight();
    const n = pix.getNumberOfComponents(); // RGB sem transparência = 3 canais
    const stride = pix.getStride();
    let pixels = pix.getPixels();
    if (stride !== w * n) {
      const packed = new Uint8Array(w * h * n);
      for (let row = 0; row < h; row++) {
        packed.set(pixels.subarray(row * stride, row * stride + w * n), row * w * n);
      }
      pixels = packed;
    }
    const raw = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const img = () => sharp(raw, { raw: { width: w, height: h, channels: n } });

    const file = `${i + 1}.webp`;
    await img().webp({ quality: QUALITY, effort: 4, smartSubsample: true }).toFile(path.join(outDir, "pages", file));

    // Miniatura para a grade de páginas do visualizador.
    await img().resize({ width: 360 }).webp({ quality: 75 }).toFile(path.join(outDir, "thumbs", file));

    // Prévia minúscula (desfocada no visualizador) enquanto a versão HD carrega.
    const tiny = await img().resize({ width: 32 }).webp({ quality: 50 }).toBuffer();
    const placeholder = `data:image/webp;base64,${tiny.toString("base64")}`;

    if (i === 0) {
      // Capa para o preview do link (WhatsApp, Instagram etc.) e para o painel.
      await img()
        .resize({ width: 1200, height: 630, fit: "contain", background: "#ffffff" })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(path.join(outDir, "og.jpg"));
      await img().resize({ width: 480 }).webp({ quality: 80 }).toFile(path.join(outDir, "thumb.webp"));
    }

    pix.destroy();
    page.destroy();
    send({ type: "page", index: i, total, width: w, height: h, file, placeholder });
  }

  doc.destroy();
  send({ type: "done", total });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    send({ type: "error", message: err?.message || String(err) });
    setTimeout(() => process.exit(1), 50);
  });
