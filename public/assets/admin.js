/* Painel de catálogos: marcas, pastas (estilo drive) e catálogos */
(() => {
  const $ = (id) => document.getElementById(id);

  let me = null;
  let lastLoginPassword = null; // evita pedir a senha provisória duas vezes no 1º acesso
  let lib = { brands: [], folders: [], catalogs: [], hostBrand: window.HOST_BRAND };
  let brand = null; // marca aberta
  let folderId = null; // pasta aberta (null = início da marca)
  let query = "";
  let pollTimer = null;

  // ---------------- utilidades ----------------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...opts,
      headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json", ...opts.headers } : opts.headers,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      if (res.status === 401 && path !== "/api/login") showLogin();
      if (data.mustChangePassword) showPassword(true);
      throw new Error(data.error || "Algo deu errado. Tente de novo.");
    }
    return data;
  }

  const toastEl = $("toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
  const fmtDate = (s) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

  function slugify(text) {
    return (
      norm(text)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "catalogo"
    );
  }

  // "catálogoMIZ_coleção_fluxo02 (1).pdf" -> "CatálogoMIZ coleção fluxo02"
  function titleFromFile(name) {
    const t = name
      .replace(/\.pdf$/i, "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("Link copiado!");
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return e;
  }

  const svg = (path) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.innerHTML = path;
    return s;
  };
  const ICON_FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  const ICON_DOTS = '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>';

  // ---------------- dados derivados ----------------
  const brandInfo = (id = brand) => lib.brands.find((b) => b.id === id);
  const folderById = (id) => lib.folders.find((f) => f.id === id);
  const foldersIn = (parent) =>
    lib.folders
      .filter((f) => f.brand === brand && (f.parentId || null) === (parent || null))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
  const catalogsIn = (parent) => lib.catalogs.filter((c) => c.brand === brand && (c.folderId || null) === (parent || null));

  /** Caminho da pasta: [raiz..., pasta] */
  function pathOf(id) {
    const out = [];
    let f = folderById(id);
    while (f) {
      out.unshift(f);
      f = f.parentId ? folderById(f.parentId) : null;
    }
    return out;
  }
  const pathLabel = (id) => [brandInfo()?.name || "", ...pathOf(id).map((f) => f.name)].join(" › ");
  const currentName = () => (folderId ? folderById(folderId)?.name : `Início ${brandInfo()?.name || ""}`.trim());

  function descendantIds(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const f of lib.folders) if (f.parentId === out[i]) out.push(f.id);
    return out;
  }

  // ---------------- telas ----------------
  function show(view) {
    for (const v of ["viewLogin", "viewPassword", "viewApp"]) $(v).hidden = v !== view;
  }

  function showLogin() {
    stopPolling();
    me = null;
    show("viewLogin");
    $("loginForm").reset();
    setTimeout(() => $("loginForm").email.focus(), 0);
  }

  function showPassword(forced) {
    show("viewPassword");
    const f = $("pwForm");
    f.reset();
    showError($("pwError"), "");
    $("pwTitle").textContent = forced ? `Olá, ${me?.name || ""}! Crie sua nova senha` : "Alterar senha";
    $("pwSub").textContent = forced
      ? "Este é seu primeiro acesso. Escolha uma senha só sua para continuar."
      : "Digite sua senha atual e escolha a nova.";
    const needCurrent = !(forced && lastLoginPassword);
    $("pwCurrentWrap").hidden = !needCurrent;
    f.current.required = needCurrent;
    $("pwCancel").hidden = forced;
    setTimeout(() => (needCurrent ? f.current : f.password).focus(), 0);
  }

  async function showApp() {
    show("viewApp");
    $("userName").textContent = me.name;
    await loadLibrary();
    readHash();
    render();
  }

  function route() {
    if (!me) return showLogin();
    if (me.mustChangePassword) return showPassword(true);
    showApp();
  }

  // ---------------- navegação (endereço #/marca/pasta) ----------------
  function readHash() {
    const [, b, f] = location.hash.split("/");
    const allowed = lib.brands.map((x) => x.id);
    brand = allowed.includes(b) ? b : allowed.includes(lib.hostBrand) ? lib.hostBrand : allowed[0];
    const folder = f && folderById(f);
    folderId = folder && folder.brand === brand ? folder.id : null;
  }

  function go(newBrand, newFolder) {
    brand = newBrand;
    folderId = newFolder || null;
    query = "";
    $("search").value = "";
    const hash = `#/${brand}${folderId ? `/${folderId}` : ""}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
    render();
    window.scrollTo({ top: 0 });
  }

  window.addEventListener("popstate", () => {
    if (!me || $("viewApp").hidden) return;
    readHash();
    render();
  });

  // ---------------- login ----------------
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    showError($("loginError"), "");
    try {
      const { user } = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: f.email.value, password: f.password.value }),
      });
      me = user;
      lastLoginPassword = user.mustChangePassword ? f.password.value : null;
      route();
    } catch (err) {
      showError($("loginError"), err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- troca de senha ----------------
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    showError($("pwError"), "");
    if (f.password.value !== f.confirm.value) return showError($("pwError"), "As duas senhas não são iguais.");
    if (f.password.value.length < 8) return showError($("pwError"), "A nova senha precisa ter pelo menos 8 caracteres.");
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const current = $("pwCurrentWrap").hidden ? lastLoginPassword : f.current.value;
      const { user } = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: f.password.value }),
      });
      me = user;
      lastLoginPassword = null;
      toast("Senha alterada com sucesso.");
      showApp();
    } catch (err) {
      showError($("pwError"), err.message);
    } finally {
      btn.disabled = false;
    }
  });
  $("pwCancel").addEventListener("click", () => {
    show("viewApp");
    render();
  });
  $("btnChangePw").addEventListener("click", () => showPassword(false));

  $("btnLogout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  // ---------------- dados ----------------
  async function loadLibrary() {
    const wasProcessing = new Set(lib.catalogs.filter((c) => c.processing).map((c) => c.id));
    const data = await api("/api/library");
    lib = data;
    const justFinished = lib.catalogs.find((c) => wasProcessing.has(c.id) && !c.processing && !c.error);
    if (justFinished) toast(`“${justFinished.title}” está pronto para enviar às clientes.`);
    if (lib.catalogs.some((c) => c.processing)) startPolling();
    else stopPolling();
    return justFinished;
  }

  async function refresh(flashId) {
    try {
      const finished = await loadLibrary();
      if (folderId && !folderById(folderId)) folderId = null; // pasta excluída
      render(flashId || finished?.id);
    } catch {}
  }

  function startPolling() {
    if (!pollTimer) pollTimer = setInterval(() => refresh(), 2500);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // ---------------- render ----------------
  function render(flashId) {
    if (!brand) return;
    renderTop();
    renderCrumbs();
    $("uploadWhere").textContent = currentName();
    $("slugPrefix").textContent = `${(brandInfo()?.url || location.origin).replace(/^https?:\/\//, "")}/c/`;

    if (query) return renderSearch();

    const subfolders = foldersIn(folderId);
    const items = catalogsIn(folderId);
    $("foldersSection").hidden = subfolders.length === 0;
    $("catalogsSection").hidden = items.length === 0;
    $("folders").replaceChildren(...subfolders.map(folderTile));
    $("list").replaceChildren(...items.map((c) => catalogCard(c, flashId)));
    $("listCount").textContent = items.length ? plural(items.length, "catálogo", "catálogos") : "";

    const empty = $("empty");
    empty.hidden = subfolders.length + items.length > 0;
    if (!empty.hidden) {
      empty.replaceChildren(
        svg(ICON_FOLDER),
        el("strong", {}, folderId ? "Esta pasta está vazia" : `Nenhum catálogo da ${brandInfo()?.name} ainda`),
        el("span", {}, "Crie uma pasta para organizar ou envie o primeiro PDF.")
      );
    }
  }

  function renderTop() {
    const b = brandInfo();
    const logo = $("topLogo");
    logo.src = b.logo;
    logo.alt = b.name;
    logo.style.height = `${b.adminLogoHeight}px`;
    document.title = `Catálogos ${b.name} · Painel`;
    const icon = document.querySelector('link[rel="icon"][sizes="32x32"]');
    if (icon) icon.href = b.favicon;

    const sw = $("brandSwitch");
    sw.hidden = lib.brands.length < 2;
    sw.replaceChildren(
      ...lib.brands.map((x) =>
        el(
          "button",
          {
            type: "button",
            role: "tab",
            class: x.id === brand ? "active" : "",
            "aria-selected": String(x.id === brand),
            onclick: () => x.id !== brand && go(x.id, null),
          },
          x.name
        )
      )
    );
  }

  function renderCrumbs() {
    const parts = [{ id: null, name: `Início ${brandInfo()?.name || ""}`.trim() }, ...pathOf(folderId)];
    const nav = $("crumbs");
    nav.replaceChildren(
      ...parts.flatMap((p, i) => {
        const last = i === parts.length - 1 && !query;
        const crumb = el(
          last ? "span" : "button",
          { type: last ? undefined : "button", class: `crumb${last ? " current" : ""}`, onclick: last ? undefined : () => go(brand, p.id) },
          p.name
        );
        if (!last) makeDropTarget(crumb, p.id);
        return i === 0 ? [crumb] : [el("span", { class: "sep", "aria-hidden": "true" }, "›"), crumb];
      }),
      ...(query ? [el("span", { class: "sep" }, "›"), el("span", { class: "crumb current" }, `Busca: “${query}”`)] : [])
    );
  }

  function renderSearch() {
    const q = norm(query);
    const fs = lib.folders.filter((f) => f.brand === brand && norm(f.name).includes(q));
    const cs = lib.catalogs.filter((c) => c.brand === brand && (norm(c.title).includes(q) || c.slug.includes(slugify(query))));
    $("foldersSection").hidden = fs.length === 0;
    $("catalogsSection").hidden = cs.length === 0;
    $("folders").replaceChildren(...fs.map((f) => folderTile(f, true)));
    $("list").replaceChildren(...cs.map((c) => catalogCard(c, null, true)));
    $("listCount").textContent = cs.length ? plural(cs.length, "resultado", "resultados") : "";
    const empty = $("empty");
    empty.hidden = fs.length + cs.length > 0;
    if (!empty.hidden) {
      empty.replaceChildren(el("strong", {}, "Nada encontrado"), el("span", {}, `Nenhuma pasta ou catálogo com “${query}”.`));
    }
  }

  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = e.target.value.trim();
      render();
    }, 150);
  });

  // ---------------- pastas ----------------
  function folderTile(f, showPath) {
    const nFolders = lib.folders.filter((x) => x.parentId === f.id).length;
    const nCats = lib.catalogs.filter((c) => c.folderId === f.id).length;
    const meta = [nFolders ? plural(nFolders, "pasta", "pastas") : null, plural(nCats, "catálogo", "catálogos")].filter(Boolean).join(" · ");
    const tile = el(
      "div",
      { class: "folder", role: "button", tabindex: "0", title: `Abrir ${f.name}` },
      el("span", { class: "folder-icon" }, svg(ICON_FOLDER)),
      el(
        "span",
        { class: "folder-text" },
        el("span", { class: "folder-name" }, f.name),
        el("span", { class: "folder-meta" }, showPath ? `em ${pathLabel(f.parentId)}` : meta)
      ),
      el(
        "button",
        {
          type: "button",
          class: "dots",
          "aria-label": `Opções da pasta ${f.name}`,
          onclick: (e) => {
            e.stopPropagation();
            openMenu(e.currentTarget, [
              ["Abrir", () => go(brand, f.id)],
              ["Renomear", () => openFolderDialog(f)],
              ["Mover para…", () => openMove({ type: "folder", item: f })],
              ["Excluir", () => removeFolder(f), true],
            ]);
          },
        },
        svg(ICON_DOTS)
      )
    );
    tile.addEventListener("click", () => go(brand, f.id));
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === tile) go(brand, f.id);
    });
    makeDropTarget(tile, f.id);
    return tile;
  }

  function openFolderDialog(existing) {
    const d = $("folderDialog");
    const f = $("folderForm");
    f.name.value = existing ? existing.name : "";
    $("folderDialogTitle").textContent = existing ? "Renomear pasta" : "Nova pasta";
    $("folderSave").textContent = existing ? "Salvar" : "Criar pasta";
    $("folderWhere").textContent = existing ? "" : `Será criada em: ${pathLabel(folderId)}`;
    $("folderWhere").hidden = !!existing;
    showError($("folderError"), "");
    d.dataset.id = existing ? existing.id : "";
    d.showModal();
    f.name.select();
  }
  $("btnNewFolder").addEventListener("click", () => openFolderDialog(null));

  $("folderForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const d = $("folderDialog");
    const name = e.target.name.value.trim();
    if (!name) return showError($("folderError"), "Dê um nome para a pasta.");
    try {
      if (d.dataset.id) {
        await api(`/api/folders/${d.dataset.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        toast("Pasta renomeada.");
      } else {
        await api("/api/folders", { method: "POST", body: JSON.stringify({ brand, parentId: folderId, name }) });
        toast(`Pasta “${name}” criada.`);
      }
      d.close();
      refresh();
    } catch (err) {
      showError($("folderError"), err.message);
    }
  });

  async function removeFolder(f) {
    const ids = descendantIds(f.id);
    const nSub = ids.length - 1;
    const nCats = lib.catalogs.filter((c) => ids.includes(c.folderId)).length;
    const inside = [nSub ? plural(nSub, "subpasta", "subpastas") : null, nCats ? plural(nCats, "catálogo", "catálogos") : null]
      .filter(Boolean)
      .join(" e ");
    const ok = await confirmDialog(
      `Excluir a pasta “${f.name}”?`,
      inside
        ? `Tudo o que está dentro dela também será excluído: ${inside}. Os links desses catálogos vão parar de funcionar. Isso não pode ser desfeito.`
        : "A pasta está vazia. Isso não pode ser desfeito.",
      "Excluir pasta"
    );
    if (!ok) return;
    try {
      await api(`/api/folders/${f.id}`, { method: "DELETE" });
      toast("Pasta excluída.");
      if (descendantIds(f.id).includes(folderId)) go(brand, f.parentId);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------------- mover (menu e arrastar) ----------------
  let moving = null;
  function openMove(target) {
    moving = target;
    const isFolder = target.type === "folder";
    const blocked = isFolder ? new Set(descendantIds(target.item.id)) : new Set();
    const currentParent = isFolder ? target.item.parentId || null : target.item.folderId || null;
    $("moveTitle").textContent = `Mover “${isFolder ? target.item.name : target.item.title}” para…`;
    showError($("moveError"), "");

    const rows = [];
    const addRow = (id, name, depth) => {
      const disabled = id !== null && blocked.has(id);
      rows.push(
        el(
          "label",
          { class: `tree-row${disabled ? " disabled" : ""}`, style: `--depth:${depth}` },
          el("input", { type: "radio", name: "dest", value: id || "", checked: id === currentParent, disabled }),
          svg(ICON_FOLDER),
          el("span", {}, name),
          id === currentParent ? el("em", {}, "atual") : null
        )
      );
      if (id !== null && blocked.has(id)) return; // não lista dentro da própria pasta
      for (const child of foldersIn(id)) addRow(child.id, child.name, depth + 1);
    };
    addRow(null, `Início ${brandInfo().name}`, 0);
    $("moveTree").replaceChildren(...rows);
    $("moveDialog").showModal();
  }

  async function moveTo(target, dest) {
    const isFolder = target.type === "folder";
    const url = isFolder ? `/api/folders/${target.item.id}` : `/api/catalogs/${target.item.id}`;
    const body = isFolder ? { parentId: dest } : { folderId: dest };
    await api(url, { method: "PATCH", body: JSON.stringify(body) });
    toast(`Movido para ${dest ? folderById(dest)?.name : `Início ${brandInfo().name}`}.`);
    refresh();
  }

  $("moveForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const sel = e.target.querySelector('input[name="dest"]:checked');
    if (!sel) return showError($("moveError"), "Escolha a pasta de destino.");
    try {
      await moveTo(moving, sel.value || null);
      $("moveDialog").close();
    } catch (err) {
      showError($("moveError"), err.message);
    }
  });

  // Arrastar catálogo ou pasta para cima de uma pasta (ou de um item do caminho).
  let dragging = null;
  function makeDraggable(node, target) {
    node.draggable = true;
    node.addEventListener("dragstart", (e) => {
      dragging = target;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", target.item.id);
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => {
      dragging = null;
      node.classList.remove("dragging");
      document.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
    });
  }
  function canDrop(dest) {
    if (!dragging) return false;
    if (dragging.type === "folder") {
      if (descendantIds(dragging.item.id).includes(dest)) return false;
      return (dragging.item.parentId || null) !== (dest || null);
    }
    return (dragging.item.folderId || null) !== (dest || null);
  }
  function makeDropTarget(node, dest) {
    node.addEventListener("dragover", (e) => {
      if (!canDrop(dest)) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.add("drop-target");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop-target"));
    node.addEventListener("drop", (e) => {
      node.classList.remove("drop-target");
      if (!canDrop(dest)) return;
      e.preventDefault();
      e.stopPropagation();
      const t = dragging;
      dragging = null;
      moveTo(t, dest).catch((err) => toast(err.message));
    });
  }

  // ---------------- menu de opções ----------------
  const menu = $("menu");
  function openMenu(anchor, items) {
    menu.replaceChildren(
      ...items.map(([label, fn, danger]) =>
        el(
          "button",
          {
            type: "button",
            role: "menuitem",
            class: danger ? "danger" : "",
            onclick: () => {
              closeMenu();
              fn();
            },
          },
          label
        )
      )
    );
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    menu.querySelector("button")?.focus();
  }
  function closeMenu() {
    menu.hidden = true;
  }
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
  window.addEventListener("resize", closeMenu);

  // ---------------- catálogos ----------------
  function statusPill(c) {
    if (c.processing && !c.ready) return el("span", { class: "pill proc" }, "Preparando");
    if (c.processing && c.ready) return el("span", { class: "pill proc" }, "Atualizando PDF");
    if (c.error && !c.ready) return el("span", { class: "pill err" }, "Erro");
    if (!c.published) return el("span", { class: "pill" }, "Fora do ar");
    return el("span", { class: "pill ok" }, "No ar");
  }

  function catalogCard(c, flashId, showPath) {
    const cover = el("div", { class: "cover" }, c.thumb ? el("img", { src: c.thumb, alt: "", loading: "lazy" }) : "PDF");
    const meta = [
      showPath ? `em ${pathLabel(c.folderId)}` : null,
      c.pageCount ? plural(c.pageCount, "página", "páginas") : null,
      c.size ? `PDF de ${fmtSize(c.size)}` : null,
      `criado em ${fmtDate(c.createdAt)}`,
      c.allowDownload ? "download liberado" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    let progress = null;
    if (c.processing) {
      const { done, total, queued } = c.processing;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const label = queued
        ? "Na fila: começa assim que o catálogo anterior terminar…"
        : total
          ? `Preparando páginas em alta resolução: ${done} de ${total}`
          : "Abrindo o PDF…";
      progress = el(
        "div",
        {},
        el("div", { class: "meta" }, label),
        el("div", { class: "proc-bar" }, el("div", { class: "fill", style: `width:${pct}%` }))
      );
    }

    const wa = `https://wa.me/?text=${encodeURIComponent(`${c.title}\n${c.url}`)}`;
    const linkBox = el(
      "div",
      { class: "link-box" },
      el("input", { type: "text", readonly: true, value: c.url, onclick: (e) => e.target.select(), "aria-label": "Link do catálogo" }),
      el("button", { class: "btn primary sm", type: "button", onclick: () => copy(c.url) }, "Copiar link"),
      el("a", { class: "btn ghost sm", href: c.url, target: "_blank", rel: "noopener" }, "Abrir"),
      el("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "WhatsApp")
    );

    const actions = el(
      "div",
      { class: "actions" },
      el("button", { class: "btn ghost sm", type: "button", onclick: () => openEdit(c) }, "Editar"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => openMove({ type: "catalog", item: c }) }, "Mover"),
      el("button", { class: "btn ghost sm", type: "button", disabled: !!c.processing, onclick: () => pickReplace(c) }, "Substituir PDF"),
      c.ready
        ? el("button", { class: "btn ghost sm", type: "button", onclick: () => togglePublished(c) }, c.published ? "Tirar do ar" : "Colocar no ar")
        : null,
      el("button", { class: "btn ghost sm", type: "button", onclick: () => removeCatalog(c) }, "Excluir")
    );

    const item = el(
      "article",
      { class: "item" },
      cover,
      el(
        "div",
        { class: "body" },
        el("div", { class: "head" }, el("span", { class: "name" }, c.title), statusPill(c)),
        el("div", { class: "meta" }, meta),
        progress,
        c.error ? el("div", { class: "err-text" }, c.error) : null,
        linkBox,
        actions
      )
    );
    // arrastar pela capa/título para mover entre pastas
    makeDraggable(item, { type: "catalog", item: c });
    item.querySelectorAll("input, a, button").forEach((x) => (x.draggable = false));
    if (c.id === flashId) {
      item.classList.add("flash");
      setTimeout(() => item.classList.remove("flash"), 2500);
    }
    return item;
  }

  function confirmDialog(title, text, okLabel) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmOk").textContent = okLabel;
    const d = $("confirmDialog");
    d.returnValue = "";
    d.showModal();
    return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
  }

  async function togglePublished(c) {
    try {
      const { catalog } = await api(`/api/catalogs/${c.id}`, { method: "PATCH", body: JSON.stringify({ published: !c.published }) });
      toast(catalog.published ? "Catálogo no ar." : "Catálogo fora do ar. O link mostra “não encontrado”.");
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  async function removeCatalog(c) {
    const ok = await confirmDialog(
      "Excluir catálogo?",
      `“${c.title}” será apagado do servidor e o link deixará de funcionar. Isso não pode ser desfeito.`,
      "Excluir"
    );
    if (!ok) return;
    try {
      await api(`/api/catalogs/${c.id}`, { method: "DELETE" });
      toast("Catálogo excluído.");
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  // substituir PDF mantendo o mesmo link
  let replaceTarget = null;
  function pickReplace(c) {
    replaceTarget = c;
    $("replaceInput").value = "";
    $("replaceInput").click();
  }
  $("replaceInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const c = replaceTarget;
    if (!file || !c) return;
    const ok = await confirmDialog(
      "Substituir o PDF?",
      `As clientes continuarão usando o mesmo link. Enquanto o novo arquivo é preparado, a versão atual de “${c.title}” segue no ar.`,
      "Substituir"
    );
    if (!ok) return;
    const form = new FormData();
    form.append("pdf", file);
    toast("Enviando o novo PDF…");
    try {
      await uploadWithProgress(`/api/catalogs/${c.id}/replace`, form, (p) => {
        if (p < 1) toastEl.textContent = `Enviando o novo PDF… ${Math.round(p * 100)}%`;
      });
      toast("Novo PDF enviado. Preparando páginas…");
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  // editar
  let editing = null;
  function openEdit(c) {
    editing = c;
    const f = $("editForm");
    f.title.value = c.title;
    f.slug.value = c.slug;
    f.allowDownload.checked = c.allowDownload;
    f.querySelector(".slug-prefix").textContent = `${c.url.replace(/^https?:\/\//, "").replace(/\/c\/.*$/, "")}/c/`;
    $("slugWarn").hidden = true;
    showError($("editError"), "");
    $("editDialog").showModal();
  }
  $("editForm").slug.addEventListener("input", (e) => {
    $("slugWarn").hidden = !editing || slugify(e.target.value) === editing.slug;
  });
  $("editForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/catalogs/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: f.title.value, slug: slugify(f.slug.value), allowDownload: f.allowDownload.checked }),
      });
      $("editDialog").close();
      toast("Alterações salvas.");
      refresh();
    } catch (err) {
      showError($("editError"), err.message);
    }
  });

  // ---------------- novo catálogo ----------------
  let selectedFile = null;
  let slugTouched = false;
  const drop = $("drop");
  const fileInput = $("fileInput");

  (() => {
    // título/subtítulo da área de envio num bloco só (layout "arquivo escolhido")
    const wrap = document.createElement("div");
    wrap.append($("dropTitle"), $("dropSub"));
    drop.append(wrap);
  })();

  function openUpload() {
    $("uploadCard").hidden = false;
    $("uploadCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("btnUpload").addEventListener("click", () => {
    openUpload();
    if (!selectedFile) fileInput.click();
  });
  $("uploadClose").addEventListener("click", () => {
    setFile(null);
    $("uploadCard").hidden = true;
  });

  function setFile(file) {
    if (file && !/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      toast("Escolha um arquivo PDF.");
      return;
    }
    selectedFile = file || null;
    showError($("uploadError"), "");
    if (!file) {
      drop.classList.remove("has-file");
      $("dropTitle").textContent = "Arraste o PDF aqui ou clique para escolher";
      $("dropSub").textContent = "Arquivos grandes são aceitos, sem perda de qualidade.";
      $("uploadFields").hidden = true;
      fileInput.value = "";
      return;
    }
    openUpload();
    drop.classList.add("has-file");
    $("dropTitle").textContent = file.name;
    $("dropSub").textContent = `${fmtSize(file.size)} · clique para escolher outro`;
    $("uploadFields").hidden = false;
    const t = titleFromFile(file.name);
    $("titleInput").value = t;
    slugTouched = false;
    $("slugInput").value = slugify(t);
    $("titleInput").focus();
    $("titleInput").select();
  }

  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
  $("btnClearFile").addEventListener("click", () => fileInput.click());
  $("titleInput").addEventListener("input", (e) => {
    if (!slugTouched) $("slugInput").value = slugify(e.target.value);
  });
  $("slugInput").addEventListener("input", () => (slugTouched = true));
  $("slugInput").addEventListener("blur", (e) => (e.target.value = slugify(e.target.value)));

  // Soltar um PDF em qualquer lugar do painel abre o envio para a pasta atual.
  const overlay = $("dropOverlay");
  let dragDepth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!isFileDrag(e) || $("viewApp").hidden) return;
    dragDepth++;
    $("dropOverlayWhere").textContent = currentName();
    overlay.hidden = false;
  });
  window.addEventListener("dragleave", (e) => {
    if (!isFileDrag(e)) return;
    if (--dragDepth <= 0) {
      dragDepth = 0;
      overlay.hidden = true;
    }
  });
  window.addEventListener("dragover", (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (!$("viewApp").hidden && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  /** Envia o arquivo com barra de progresso (fetch ainda não informa progresso de upload). */
  function uploadWithProgress(url, form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status === 401) showLogin();
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || (xhr.status === 413 ? "Arquivo grande demais para o servidor." : "Falha no envio. Tente de novo.")));
      };
      xhr.onerror = () => reject(new Error("Conexão interrompida durante o envio. Tente de novo."));
      xhr.send(form);
    });
  }

  $("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    const btn = $("btnGenerate");
    btn.disabled = true;
    $("btnClearFile").disabled = true;
    showError($("uploadError"), "");
    $("upProgress").hidden = false;
    const setProg = (p) => {
      $("upFill").style.width = `${Math.round(p * 100)}%`;
      $("upText").textContent = p < 1 ? `Enviando… ${Math.round(p * 100)}%` : "Enviado. Preparando páginas…";
    };
    setProg(0);

    const form = new FormData();
    form.append("brand", brand);
    form.append("folderId", folderId || "");
    form.append("title", $("titleInput").value.trim());
    form.append("slug", slugify($("slugInput").value));
    form.append("allowDownload", String($("dlInput").checked));
    form.append("pdf", selectedFile);

    try {
      const { catalog } = await uploadWithProgress("/api/catalogs", form, setProg);
      setFile(null);
      $("dlInput").checked = false;
      $("uploadCard").hidden = true;
      toast("Catálogo enviado! O link já está pronto, as páginas estão sendo preparadas.");
      await refresh(catalog.id);
    } catch (err) {
      showError($("uploadError"), err.message);
    } finally {
      btn.disabled = false;
      $("btnClearFile").disabled = false;
      $("upProgress").hidden = true;
    }
  });

  // botões "Cancelar" dos diálogos (não são de envio, para o Enter salvar)
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  // ---------------- início ----------------
  api("/api/me")
    .then(({ user }) => {
      me = user;
      route();
    })
    .catch(() => showLogin());
})();
