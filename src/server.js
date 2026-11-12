import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { config, paths, DATA_DIR } from "./config.js";
import { initAuth, authRoutes, loadUser, requireAuth, sameOrigin } from "./auth.js";
import * as catalogs from "./catalogs.js";
import { renderViewer, renderMessage, ASSET_V } from "./viewer-page.js";

for (const dir of [DATA_DIR, paths.media, paths.originals, paths.tmp]) fs.mkdirSync(dir, { recursive: true });
// limpa uploads incompletos de execuções anteriores
for (const f of fs.readdirSync(paths.tmp)) fs.rmSync(path.join(paths.tmp, f), { force: true, recursive: true });

initAuth();
catalogs.initCatalogs();

const app = express();
// Easypanel/Traefik fica na frente, na rede interna do Docker
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.disable("x-powered-by");

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- arquivos estáticos ----------
// Páginas geradas: cada versão tem pasta própria, então podem ficar em cache "para sempre".
// Catálogo fora do ar ou excluído: as imagens também deixam de ser servidas.
app.use("/media/:id", (req, res, next) => {
  const c = catalogs.get(req.params.id);
  if (!c || !c.published) return res.status(404).end();
  next();
});
app.use(
  "/media",
  express.static(paths.media, {
    immutable: true,
    maxAge: "365d",
    index: false,
    dotfiles: "deny",
  })
);
app.use("/assets", express.static(path.join(paths.public, "assets"), { maxAge: "5m" }));

// ---------- API do painel ----------
app.use("/api", express.json({ limit: "100kb" }), loadUser, sameOrigin);
authRoutes(app);

const upload = multer({
  dest: paths.tmp,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname);
    cb(ok ? null : Object.assign(new Error("Envie um arquivo PDF."), { status: 400 }), ok);
  },
});

function isPdf(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1024);
  fs.readSync(fd, buf, 0, 1024, 0);
  fs.closeSync(fd);
  return buf.includes("%PDF-");
}

// multer grava o nome em latin1; corrige acentos (ex.: "catálogo.pdf")
const fixName = (name) => Buffer.from(name, "latin1").toString("utf8");

app.get("/api/catalogs", requireAuth, (req, res) => {
  res.json({ catalogs: catalogs.list().map((c) => catalogs.toAdmin(c, baseUrl(req))) });
});

app.post("/api/catalogs", requireAuth, upload.single("pdf"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Anexe o PDF do catálogo." });
  if (!isPdf(req.file.path)) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "O arquivo enviado não é um PDF válido." });
  }
  const c = catalogs.create({
    title: req.body.title,
    slug: req.body.slug,
    allowDownload: req.body.allowDownload === "true",
    tmpFile: req.file.path,
    originalName: fixName(req.file.originalname),
    size: req.file.size,
    user: req.user.email,
  });
  res.status(201).json({ catalog: catalogs.toAdmin(c, baseUrl(req)) });
});

app.post("/api/catalogs/:id/replace", requireAuth, upload.single("pdf"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Anexe o novo PDF." });
  if (!isPdf(req.file.path)) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "O arquivo enviado não é um PDF válido." });
  }
  try {
    const c = catalogs.replacePdf(req.params.id, {
      tmpFile: req.file.path,
      originalName: fixName(req.file.originalname),
      size: req.file.size,
    });
    if (!c) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(404).json({ error: "Catálogo não encontrado." });
    }
    res.json({ catalog: catalogs.toAdmin(c, baseUrl(req)) });
  } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.patch("/api/catalogs/:id", requireAuth, (req, res) => {
  const c = catalogs.update(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: "Catálogo não encontrado." });
  res.json({ catalog: catalogs.toAdmin(c, baseUrl(req)) });
});

app.delete("/api/catalogs/:id", requireAuth, (req, res) => {
  if (!catalogs.remove(req.params.id)) return res.status(404).json({ error: "Catálogo não encontrado." });
  res.json({ ok: true });
});

// ---------- painel ----------
const adminHtml = fs
  .readFileSync(path.join(paths.public, "admin.html"), "utf8")
  .replace(/\/assets\/(admin\.(?:css|js))/g, `/assets/$1?v=${ASSET_V}`);

app.get(["/admin", "/admin/"], (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(adminHtml);
});

// ---------- catálogo público ----------
app.get("/c/:slug", (req, res) => {
  const c = catalogs.getBySlug(req.params.slug);
  res.setHeader("Cache-Control", "no-cache");
  if (!c || !c.published) {
    return res.status(404).send(renderMessage("Catálogo não encontrado", "Este link não existe ou o catálogo foi retirado do ar."));
  }
  if (!c.version) {
    return res
      .status(503)
      .send(renderMessage("Catálogo em preparação", "Este catálogo está sendo preparado. Tente de novo em alguns minutos.", true));
  }
  res.send(renderViewer(c, baseUrl(req)));
});

app.get("/c/:slug/pdf", (req, res) => {
  const c = catalogs.getBySlug(req.params.slug);
  if (!c || !c.published || !c.allowDownload) return res.status(404).send("Não disponível.");
  const name = `${c.slug}.pdf`;
  res.download(catalogs.originalPath(c.id), name);
});

app.get("/", (_req, res) => res.redirect("/admin"));

app.use((req, res) => res.status(404).send(renderMessage("Página não encontrada", "Confira o link e tente de novo.")));

// erros (upload grande demais, etc.)
app.use((err, req, res, _next) => {
  if (req.file) fs.rmSync(req.file.path, { force: true });
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 500;
  const message =
    err.code === "LIMIT_FILE_SIZE" ? `O arquivo passa do limite de ${config.maxUploadMb} MB.` : err.message || "Erro inesperado.";
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const server = app.listen(config.port, () => {
  console.log(`Catálogos ${config.brandName} rodando em http://localhost:${config.port}  (dados em ${DATA_DIR})`);
});
// uploads grandes em conexões lentas
server.requestTimeout = 0;
server.headersTimeout = 120_000;
