/* Painel de catálogos */
(() => {
  const $ = (id) => document.getElementById(id);
  const origin = location.origin;
  let me = null;
  let lastLoginPassword = null; // evita pedir a senha provisória duas vezes no 1º acesso
  let catalogs = [];
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
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
  const fmtDate = (s) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  function slugify(text) {
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

  function showApp() {
    show("viewApp");
    $("userName").textContent = me.name;
    $("slugPrefix").textContent = `${origin.replace(/^https?:\/\//, "")}/c/`;
    loadCatalogs();
  }

  function route() {
    if (!me) return showLogin();
    if (me.mustChangePassword) return showPassword(true);
    showApp();
  }

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
  $("pwCancel").addEventListener("click", showApp);
  $("btnChangePw").addEventListener("click", () => showPassword(false));

  $("btnLogout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  // ---------------- novo catálogo ----------------
  let selectedFile = null;
  let slugTouched = false;
  const drop = $("drop");
  const fileInput = $("fileInput");

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

  // envolve título/subtítulo num div para o layout "arquivo escolhido"
  (() => {
    const wrap = document.createElement("div");
    wrap.append($("dropTitle"), $("dropSub"));
    drop.append(wrap);
  })();

  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });
  // impede que soltar o arquivo fora da área abra o PDF no navegador
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  $("titleInput").addEventListener("input", (e) => {
    if (!slugTouched) $("slugInput").value = slugify(e.target.value);
  });
  $("slugInput").addEventListener("input", () => (slugTouched = true));
  $("slugInput").addEventListener("blur", (e) => (e.target.value = slugify(e.target.value)));
  $("btnClearFile").addEventListener("click", () => fileInput.click());

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
    form.append("title", $("titleInput").value.trim());
    form.append("slug", slugify($("slugInput").value));
    form.append("allowDownload", String($("dlInput").checked));
    form.append("pdf", selectedFile);

    try {
      const { catalog } = await uploadWithProgress("/api/catalogs", form, setProg);
      setFile(null);
      $("dlInput").checked = false;
      catalogs.unshift(catalog);
      renderList(catalog.id);
      startPolling();
      toast("Catálogo enviado! O link já está pronto, as páginas estão sendo preparadas.");
    } catch (err) {
      showError($("uploadError"), err.message);
    } finally {
      btn.disabled = false;
      $("btnClearFile").disabled = false;
      $("upProgress").hidden = true;
    }
  });

  // ---------------- lista ----------------
  async function loadCatalogs() {
    try {
      const data = await api("/api/catalogs");
      const wasProcessing = new Set(catalogs.filter((c) => c.processing).map((c) => c.id));
      catalogs = data.catalogs;
      const justFinished = catalogs.find((c) => wasProcessing.has(c.id) && !c.processing && !c.error);
      renderList(justFinished?.id);
      if (justFinished) toast(`“${justFinished.title}” está pronto para enviar às clientes.`);
      if (catalogs.some((c) => c.processing)) startPolling();
      else stopPolling();
    } catch {}
  }

  function startPolling() {
    if (!pollTimer) pollTimer = setInterval(loadCatalogs, 2500);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return e;
  }

  function statusPill(c) {
    if (c.processing && !c.ready) return el("span", { class: "pill proc" }, "Preparando");
    if (c.processing && c.ready) return el("span", { class: "pill proc" }, "Atualizando PDF");
    if (c.error && !c.ready) return el("span", { class: "pill err" }, "Erro");
    if (!c.published) return el("span", { class: "pill" }, "Fora do ar");
    return el("span", { class: "pill ok" }, "No ar");
  }

  function renderList(flashId) {
    const list = $("list");
    $("empty").hidden = catalogs.length > 0;
    $("listCount").textContent = catalogs.length ? `${catalogs.length} ${catalogs.length === 1 ? "catálogo" : "catálogos"}` : "";

    list.replaceChildren(
      ...catalogs.map((c) => {
        const cover = el("div", { class: "cover" }, c.thumb ? el("img", { src: c.thumb, alt: "", loading: "lazy" }) : "PDF");

        const meta = [
          c.pageCount ? `${c.pageCount} ${c.pageCount === 1 ? "página" : "páginas"}` : null,
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

        const linkInput = el("input", { type: "text", readonly: true, value: c.url, onclick: (e) => e.target.select() });
        const wa = `https://wa.me/?text=${encodeURIComponent(`${c.title}\n${c.url}`)}`;
        const linkBox = el(
          "div",
          { class: "link-box" },
          linkInput,
          el("button", { class: "btn primary sm", type: "button", onclick: () => copy(c.url) }, "Copiar link"),
          el("a", { class: "btn ghost sm", href: c.url, target: "_blank", rel: "noopener" }, "Abrir"),
          el("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "WhatsApp")
        );

        const actions = el(
          "div",
          { class: "actions" },
          el("button", { class: "btn ghost sm", type: "button", onclick: () => openEdit(c) }, "Editar"),
          el(
            "button",
            { class: "btn ghost sm", type: "button", disabled: !!c.processing, onclick: () => pickReplace(c) },
            "Substituir PDF"
          ),
          c.ready
            ? el(
                "button",
                { class: "btn ghost sm", type: "button", onclick: () => togglePublished(c) },
                c.published ? "Tirar do ar" : "Colocar no ar"
              )
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
        if (c.id === flashId) {
          item.classList.add("flash");
          setTimeout(() => item.classList.remove("flash"), 2500);
        }
        return item;
      })
    );
  }

  function replaceInList(updated) {
    catalogs = catalogs.map((c) => (c.id === updated.id ? updated : c));
    renderList();
  }

  // ---------------- ações ----------------
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
      replaceInList(catalog);
      toast(catalog.published ? "Catálogo no ar." : "Catálogo fora do ar. O link mostra “não encontrado”.");
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
      catalogs = catalogs.filter((x) => x.id !== c.id);
      renderList();
      toast("Catálogo excluído.");
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
      const { catalog } = await uploadWithProgress(`/api/catalogs/${c.id}/replace`, form, (p) => {
        if (p < 1) toastEl.textContent = `Enviando o novo PDF… ${Math.round(p * 100)}%`;
      });
      replaceInList(catalog);
      startPolling();
      toast("Novo PDF enviado. Preparando páginas…");
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
    f.querySelector(".slug-prefix").textContent = `${origin.replace(/^https?:\/\//, "")}/c/`;
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
      const { catalog } = await api(`/api/catalogs/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: f.title.value, slug: slugify(f.slug.value), allowDownload: f.allowDownload.checked }),
      });
      $("editDialog").close();
      replaceInList(catalog);
      toast("Alterações salvas.");
    } catch (err) {
      showError($("editError"), err.message);
    }
  });

  // ---------------- início ----------------
  api("/api/me")
    .then(({ user }) => {
      me = user;
      route();
    })
    .catch(() => showLogin());
})();
