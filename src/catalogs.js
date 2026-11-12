import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config, paths } from "./config.js";
import { JsonStore } from "./store.js";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "convert-worker.js");

let store;

export function initCatalogs() {
  store = new JsonStore(paths.catalogs, []);
  // Conversões interrompidas (ex.: servidor reiniciou) voltam para a fila.
  for (const c of store.data) {
    if (c.job) {
      if (fs.existsSync(originalPath(c.id))) enqueue(c.id);
      else {
        c.job = null;
        c.error = "A conversão foi interrompida e o PDF original não foi encontrado. Envie o PDF de novo.";
      }
    }
  }
  store.save();
}

// ---------- utilidades ----------
export const originalPath = (id) => path.join(paths.originals, `${id}.pdf`);
export const versionDir = (id, v) => path.join(paths.media, id, `v${v}`);

export function slugify(text) {
  return (
    String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "catalogo"
  );
}

function uniqueSlug(base, exceptId) {
  let slug = base;
  let n = 2;
  while (store.data.some((c) => c.slug === slug && c.id !== exceptId)) slug = `${base}-${n++}`;
  return slug;
}

export const list = () => store.data;
export const get = (id) => store.data.find((c) => c.id === id);
export const getBySlug = (slug) => store.data.find((c) => c.slug === slug);

// ---------- criação / edição ----------
export function create({ title, slug, allowDownload, tmpFile, originalName, size, user }) {
  const id = crypto.randomBytes(9).toString("base64url");
  fs.mkdirSync(paths.originals, { recursive: true });
  fs.renameSync(tmpFile, originalPath(id));
  const now = new Date().toISOString();
  const c = {
    id,
    title: String(title || "").trim() || originalName.replace(/\.pdf$/i, ""),
    slug: uniqueSlug(slugify(slug || title || originalName.replace(/\.pdf$/i, ""))),
    allowDownload: !!allowDownload,
    published: true,
    version: 0, // versão pronta e visível (0 = ainda nenhuma)
    pages: [],
    originalName,
    size,
    createdAt: now,
    updatedAt: now,
    createdBy: user,
    job: { version: 1, done: 0, total: null, startedAt: now },
    error: null,
  };
  store.data.unshift(c);
  store.save();
  enqueue(id);
  return c;
}

export function replacePdf(id, { tmpFile, originalName, size }) {
  const c = get(id);
  if (!c) return null;
  if (c.job) throw Object.assign(new Error("Este catálogo ainda está sendo processado."), { status: 409 });
  fs.renameSync(tmpFile, originalPath(id));
  c.originalName = originalName;
  c.size = size;
  c.error = null;
  c.job = { version: c.version + 1, done: 0, total: null, startedAt: new Date().toISOString() };
  c.updatedAt = new Date().toISOString();
  store.save();
  enqueue(id);
  return c;
}

export function update(id, patch) {
  const c = get(id);
  if (!c) return null;
  if (typeof patch.title === "string" && patch.title.trim()) c.title = patch.title.trim();
  if (typeof patch.slug === "string" && patch.slug.trim()) c.slug = uniqueSlug(slugify(patch.slug), id);
  if (typeof patch.allowDownload === "boolean") c.allowDownload = patch.allowDownload;
  if (typeof patch.published === "boolean") c.published = patch.published;
  c.updatedAt = new Date().toISOString();
  store.save();
  return c;
}

export function remove(id) {
  const c = get(id);
  if (!c) return false;
  if (current && current.id === id) current.child.kill();
  queue.splice(0, queue.length, ...queue.filter((q) => q !== id));
  store.data = store.data.filter((x) => x.id !== id);
  store.save();
  fs.rmSync(path.join(paths.media, id), { recursive: true, force: true });
  fs.rmSync(originalPath(id), { force: true });
  return true;
}

// ---------- fila de conversão (uma por vez) ----------
const queue = [];
let current = null;

function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  setImmediate(runNext);
}

function runNext() {
  if (current || queue.length === 0) return;
  const id = queue.shift();
  const c = get(id);
  if (!c || !c.job) return runNext();

  const version = c.job.version;
  const outDir = versionDir(id, version);
  fs.rmSync(outDir, { recursive: true, force: true });
  const pages = [];
  let failed = null;

  const child = fork(WORKER, [originalPath(id), outDir, String(config.pageSize), String(config.webpQuality)], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    execArgv: ["--max-old-space-size=2048"],
  });
  current = { id, child };
  const t0 = Date.now();
  console.log(`[conversão] ${c.title} (v${version}) iniciada`);

  child.on("message", (msg) => {
    const cat = get(id);
    if (!cat || !cat.job) return;
    if (msg.type === "start") cat.job.total = msg.total;
    if (msg.type === "page") {
      pages[msg.index] = { w: msg.width, h: msg.height, ph: msg.placeholder };
      cat.job.done = msg.index + 1;
    }
    if (msg.type === "error") failed = msg.message;
    // grava progresso de tempos em tempos (não a cada página)
    if (msg.type !== "page" || msg.index % 5 === 0) store.save();
  });

  child.on("exit", (code) => {
    current = null;
    const cat = get(id);
    if (cat) {
      if (code === 0 && !failed && pages.length > 0) {
        const old = cat.version;
        cat.pages = pages;
        cat.version = version;
        cat.job = null;
        cat.error = null;
        cat.updatedAt = new Date().toISOString();
        if (old && old !== version) fs.rmSync(versionDir(id, old), { recursive: true, force: true });
        console.log(`[conversão] ${cat.title}: ${pages.length} páginas em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } else {
        cat.job = null;
        cat.error = failed || `A conversão falhou (código ${code}). Verifique se o arquivo é um PDF válido.`;
        fs.rmSync(outDir, { recursive: true, force: true });
        console.error(`[conversão] ${cat.title}: erro — ${cat.error}`);
      }
      store.save();
    }
    setImmediate(runNext);
  });
}

// ---------- formato enviado ao painel ----------
export function toAdmin(c, baseUrl) {
  return {
    id: c.id,
    title: c.title,
    slug: c.slug,
    url: `${baseUrl}/c/${c.slug}`,
    thumb: c.version ? `/media/${c.id}/v${c.version}/thumb.webp` : null,
    allowDownload: c.allowDownload,
    published: c.published,
    pageCount: c.pages.length,
    ready: c.version > 0,
    processing: c.job
      ? { done: c.job.done, total: c.job.total, replacing: c.version > 0, queued: current?.id !== c.id }
      : null,
    error: c.error,
    originalName: c.originalName,
    size: c.size,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    createdBy: c.createdBy,
  };
}
