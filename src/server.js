import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { config, paths, DATA_DIR } from "./config.js";
import { initAuth, authRoutes, loadUser, requireAuth, sameOrigin, userBrands } from "./auth.js";
import { BRANDS, DEFAULT_BRAND, brandForHost, baseUrlFor, brandHeadIcons, publicBrandList, assetsOf } from "./brands.js";
import * as folders from "./folders.js";
import * as catalogs from "./catalogs.js";
import { renderViewer, renderMessage, ASSET_V } from "./viewer-page.js";

for (const dir of [DATA_DIR, paths.media, paths.originals, paths.tmp]) fs.mkdirSync(dir, { recursive: true });
// limpa uploads incompletos de execuções anteriores
for (const f of fs.readdirSync(paths.tmp)) fs.rmSync(path.join(paths.tmp, f), { force: true, recursive: true });

initAuth();
folders.initFolders();
catalogs.initCatalogs();

const app = express();
// Easypanel/Traefik fica na frente, na rede interna do Docker
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.disable("x-powered-by");

/** Marca da página acessada: pelo domínio; se não for um domínio de marca, a padrão. */
const hostBrand = (req) => brandForHost(req.get("host")) || DEFAULT_BRAND;

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- arquivos estáticos ----------
// Catálogo fora do ar ou excluído: as imagens também deixam de ser servidas.
app.use("/media/:id", (req, res, next) => {
  const c = catalogs.get(req.params.id);
  if (!c || !c.published) return res.status(404).end();
  next();
});
// Cada versão das páginas tem pasta própria, então podem ficar em cache "para sempre".
app.use("/media", express.static(paths.media, { immutable: true, maxAge: "365d", index: false, dotfiles: "deny" }));
app.use("/assets", express.static(path.join(paths.public, "assets"), { maxAge: "5m" }));

// ---------- API do painel ----------
app.use("/api", express.json({ limit: "100kb" }), loadUser, sameOrigin);
authRoutes(app);

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });

/** Confere se a usuária pode mexer nessa marca. */
function checkBrand(req, brand) {
  if (!BRANDS[brand]) throw httpError("Marca inválida.");
  if (!userBrands(req.user).includes(brand)) throw httpError("Você não tem acesso a esta marca.", 403);
}

/** Envolve rotas para que erros lançados virem resposta JSON. */
const handle = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    next(err);
  }
};

const upload = multer({
  dest: paths.tmp,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname);
    cb(ok ? null : httpError("Envie um arquivo PDF."), ok);
  },
});

function assertPdf(file) {
  if (!file) throw httpError("Anexe o PDF do catálogo.");
  const fd = fs.openSync(file.path, "r");
  const buf = Buffer.alloc(1024);
  fs.readSync(fd, buf, 0, 1024, 0);
  fs.closeSync(fd);
  if (!buf.includes("%PDF-")) throw httpError("O arquivo enviado não é um PDF válido.");
}

// multer grava o nome em latin1; corrige acentos (ex.: "catálogo.pdf")
const fixName = (name) => Buffer.from(name, "latin1").toString("utf8");

const folderOut = (f) => ({ id: f.id, brand: f.brand, parentId: f.parentId, name: f.name, createdAt: f.createdAt });

// Tudo o que o painel precisa: marcas permitidas, pastas e catálogos.
app.get(
  "/api/library",
  requireAuth,
  handle((req, res) => {
    const allowed = userBrands(req.user);
    res.json({
      brands: publicBrandList(allowed, req),
      hostBrand: hostBrand(req),
      folders: folders.list().filter((f) => allowed.includes(f.brand)).map(folderOut),
      catalogs: catalogs
        .list()
        .filter((c) => allowed.includes(c.brand))
        .map((c) => catalogs.toAdmin(c, req)),
    });
  })
);

// ----- pastas -----
app.post(
  "/api/folders",
  requireAuth,
  handle((req, res) => {
    const { brand, parentId, name } = req.body || {};
    checkBrand(req, brand);
    res.status(201).json({ folder: folderOut(folders.create({ brand, parentId: parentId || null, name, user: req.user.email })) });
  })
);

app.patch(
  "/api/folders/:id",
  requireAuth,
  handle((req, res) => {
    const f = folders.get(req.params.id);
    if (!f) throw httpError("Pasta não encontrada.", 404);
    checkBrand(req, f.brand);
    const patch = {};
    if (req.body?.name !== undefined) patch.name = req.body.name;
    if (req.body?.parentId !== undefined) patch.parentId = req.body.parentId || null;
    res.json({ folder: folderOut(folders.update(f.id, patch)) });
  })
);

// Exclui a pasta, as subpastas e os catálogos dentro delas.
app.delete(
  "/api/folders/:id",
  requireAuth,
  handle((req, res) => {
    const f = folders.get(req.params.id);
    if (!f) throw httpError("Pasta não encontrada.", 404);
    checkBrand(req, f.brand);
    const ids = folders.removeTree(f.id);
    const inside = catalogs.list().filter((c) => ids.includes(c.folderId));
    for (const c of inside) catalogs.remove(c.id);
    res.json({ ok: true, removedFolders: ids.length, removedCatalogs: inside.length });
  })
);

// ----- catálogos -----
app.post(
  "/api/catalogs",
  requireAuth,
  upload.single("pdf"),
  handle((req, res) => {
    assertPdf(req.file);
    const brand = req.body.brand || hostBrand(req);
    checkBrand(req, brand);
    const c = catalogs.create({
      brand,
      folderId: req.body.folderId || null,
      title: req.body.title,
      slug: req.body.slug,
      allowDownload: req.body.allowDownload === "true",
      tmpFile: req.file.path,
      originalName: fixName(req.file.originalname),
      size: req.file.size,
      user: req.user.email,
    });
    res.status(201).json({ catalog: catalogs.toAdmin(c, req) });
  })
);

const ownCatalog = (req) => {
  const c = catalogs.get(req.params.id);
  if (!c) throw httpError("Catálogo não encontrado.", 404);
  checkBrand(req, c.brand);
  return c;
};

app.post(
  "/api/catalogs/:id/replace",
  requireAuth,
  upload.single("pdf"),
  handle((req, res) => {
    assertPdf(req.file);
    const c = ownCatalog(req);
    catalogs.replacePdf(c.id, { tmpFile: req.file.path, originalName: fixName(req.file.originalname), size: req.file.size });
    res.json({ catalog: catalogs.toAdmin(c, req) });
  })
);

app.patch(
  "/api/catalogs/:id",
  requireAuth,
  handle((req, res) => {
    const c = ownCatalog(req);
    res.json({ catalog: catalogs.toAdmin(catalogs.update(c.id, req.body || {}), req) });
  })
);

app.delete(
  "/api/catalogs/:id",
  requireAuth,
  handle((req, res) => {
    catalogs.remove(ownCatalog(req).id);
    res.json({ ok: true });
  })
);

// ---------- painel ----------
// O ícone e a logo da tela de login seguem o domínio acessado.
const adminTemplate = fs
  .readFileSync(path.join(paths.public, "admin.html"), "utf8")
  .replace(/\/assets\/(admin\.(?:css|js))/g, `/assets/$1?v=${ASSET_V}`);

const adminHtml = Object.fromEntries(
  Object.keys(BRANDS).map((id) => [
    id,
    adminTemplate
      .replace("<!--BRAND_ICONS-->", brandHeadIcons(id))
      .replaceAll("{{BRAND_LOGO}}", assetsOf(id).logo)
      .replaceAll("{{BRAND_NAME}}", BRANDS[id].name)
      .replaceAll("{{BRAND_ID}}", id)
      .replaceAll("{{LOGIN_LOGO_H}}", String(BRANDS[id].loginLogoHeight)),
  ])
);

app.get(["/admin", "/admin/"], (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(adminHtml[hostBrand(req)]);
});

// ---------- catálogo público ----------
const notFound = (req, res) =>
  res
    .status(404)
    .send(renderMessage(hostBrand(req), "Catálogo não encontrado", "Este link não existe ou o catálogo foi retirado do ar."));

app.get("/c/:slug", (req, res) => {
  const c = catalogs.getBySlug(req.params.slug);
  res.setHeader("Cache-Control", "no-cache");
  if (!c || !c.published) return notFound(req, res);

  // Link de uma marca aberto no domínio da outra: leva para o domínio certo.
  const accessed = brandForHost(req.get("host"));
  if (accessed && accessed !== c.brand) {
    return res.redirect(301, `${baseUrlFor(c.brand, req)}/c/${encodeURIComponent(c.slug)}`);
  }
  if (!c.version) {
    return res
      .status(503)
      .send(renderMessage(c.brand, "Catálogo em preparação", "Este catálogo está sendo preparado. Tente de novo em alguns minutos.", true));
  }
  res.send(renderViewer(c, baseUrlFor(c.brand, req)));
});

app.get("/c/:slug/pdf", (req, res) => {
  const c = catalogs.getBySlug(req.params.slug);
  if (!c || !c.published || !c.allowDownload) return notFound(req, res);
  res.download(catalogs.originalPath(c.id), `${c.slug}.pdf`);
});

app.get("/", (_req, res) => res.redirect("/admin"));

app.use((req, res) =>
  res.status(404).send(renderMessage(hostBrand(req), "Página não encontrada", "Confira o link e tente de novo."))
);

// erros (upload grande demais, validações etc.)
app.use((err, req, res, _next) => {
  if (req.file) fs.rmSync(req.file.path, { force: true });
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 500;
  const message =
    err.code === "LIMIT_FILE_SIZE" ? `O arquivo passa do limite de ${config.maxUploadMb} MB.` : err.message || "Erro inesperado.";
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const server = app.listen(config.port, () => {
  console.log(`Catálogos rodando em http://localhost:${config.port}  (dados em ${DATA_DIR})`);
  for (const b of Object.values(BRANDS)) console.log(`  ${b.name}: ${b.publicUrl}`);
});
// uploads grandes em conexões lentas
server.requestTimeout = 0;
server.headersTimeout = 120_000;
