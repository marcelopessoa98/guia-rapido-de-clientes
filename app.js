(() => {
  "use strict";

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.database();
  const state = { user: null, profile: null, clients: {}, works: {}, registry: {}, deleteId: null, subscribed: false };
  const $ = (id) => document.getElementById(id);
  const normalize = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const parseReferences = (value = "") => [...new Set(String(value).split(/[,;\s]+/).map((ref) => ref.trim().toUpperCase()).filter(Boolean))];
  const validReference = (reference) => /^[A-Z]{2,3}$/.test(reference);
  const now = () => Date.now();

  function toast(message, error = false) {
    const node = document.createElement("div");
    node.className = `toast${error ? " toast--error" : ""}`;
    node.textContent = message;
    $("toastRegion").append(node);
    setTimeout(() => node.remove(), 4200);
  }

  function friendlyError(error) {
    const code = error?.code || "";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "E-mail ou senha inválidos.";
    if (code === "auth/too-many-requests") return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (/permission|PERMISSION_DENIED/i.test(`${code} ${error?.message}`)) return "Seu usuário não tem permissão para realizar esta ação.";
    if (/network|offline/i.test(`${code} ${error?.message}`)) return "Verifique sua internet e tente novamente.";
    return error?.message || "Não foi possível concluir a operação.";
  }

  async function login(event) {
    event.preventDefault();
    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "Entrando...";
    $("loginError").hidden = true;
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPassword").value);
    } catch (error) {
      $("loginError").textContent = friendlyError(error);
      $("loginError").hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "Entrar";
    }
  }

  async function handleAuth(user) {
    if (!user) {
      unsubscribe();
      state.user = null;
      state.profile = null;
      state.clients = {};
      state.works = {};
      state.registry = {};
      $("appShell").hidden = true;
      $("loginScreen").hidden = false;
      return;
    }
    try {
      const profile = (await db.ref(`usuarios/${user.uid}`).once("value")).val();
      if (!profile?.ativo) throw new Error("Usuário sem acesso ativo.");
      state.user = user;
      state.profile = profile;
      $("userLabel").textContent = profile.nome || user.email;
      $("newButton").hidden = profile.role === "LEITOR";
      $("loginScreen").hidden = true;
      $("appShell").hidden = false;
      subscribe();
    } catch (error) {
      await auth.signOut();
      $("loginError").textContent = friendlyError(error);
      $("loginError").hidden = false;
    }
  }

  function allWorks() {
    return Object.entries(state.works).map(([id, work]) => ({ id, ...work })).filter((work) => !work.excluida);
  }

  function clientName(clientId) {
    return state.clients[clientId]?.nome || "Cliente não encontrado";
  }

  function displayValue(value) {
    const text = String(value ?? "").trim();
    return text ? escapeHtml(text) : '<span class="not-informed">Não informado</span>';
  }

  function formatDate(timestamp) {
    if (!Number(timestamp)) return '<span class="not-informed">Não informado</span>';
    return escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(timestamp)));
  }

  function render() {
    const query = normalize($("searchInput").value);
    const filter = $("statusFilter").value;
    const all = allWorks().sort((a, b) => clientName(a.clienteId).localeCompare(clientName(b.clienteId), "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
    const visible = all.filter((work) => {
      const active = work.situacao === "ANDAMENTO";
      if (filter === "active" && !active) return false;
      if (filter === "inactive" && active) return false;
      return !query || normalize([work.referencia, clientName(work.clienteId), work.nome].join(" ")).includes(query);
    });

    $("resultsBody").innerHTML = visible.map((work) => {
      const references = parseReferences(work.referencia);
      const active = work.situacao === "ANDAMENTO";
      const actions = state.profile?.role === "LEITOR" ? "" : `<div class="card-actions"><button class="row-button" data-edit="${work.id}">Editar</button><button class="row-button row-button--delete" data-delete="${work.id}">Excluir</button></div>`;
      return `<article class="client-card">
        <header class="client-card__header">
          <div class="client-card__heading">
            <div class="reference-list" aria-label="Referências">${references.map((ref) => `<span class="reference">${escapeHtml(ref)}</span>`).join("")}</div>
            <span class="status ${active ? "" : "status--inactive"}">${active ? "Em andamento" : "Finalizada"}</span>
          </div>
          ${actions}
        </header>
        <div class="client-card__identity">
          <div><span>Cliente</span><strong>${displayValue(clientName(work.clienteId))}</strong></div>
          <div><span>Obra</span><strong>${displayValue(work.nome)}</strong></div>
        </div>
        <dl class="client-card__details">
          <div><dt>Filial</dt><dd>${displayValue(work.filial === "MARANHAO" ? "Maranhão" : work.filial === "FORTALEZA" ? "Fortaleza" : work.filial)}</dd></div>
          <div><dt>Contato do cliente</dt><dd>${displayValue(work.contatoCliente)}</dd></div>
          <div class="detail-wide"><dt>Endereço</dt><dd>${displayValue(work.endereco)}</dd></div>
          <div><dt>Funcionário fixo</dt><dd>${displayValue(work.funcionarioFixo)}</dd></div>
          <div><dt>Tipo de laboratório</dt><dd>${displayValue(work.tipoLaboratorio)}</dd></div>
          <div><dt>Tamanho do corpo de prova</dt><dd>${displayValue(work.tamanhoCp)}</dd></div>
          <div><dt>Tipo de corpo de prova</dt><dd>${displayValue(work.tipoCp)}</dd></div>
          <div><dt>ID da prensa</dt><dd>${displayValue(work.idPrensa)}</dd></div>
          <div><dt>Última atualização</dt><dd>${formatDate(work.updatedAt)}</dd></div>
          <div class="detail-wide"><dt>Observações</dt><dd class="observations">${displayValue(work.observacoes)}</dd></div>
        </dl>
      </article>`;
    }).join("");
    $("emptyState").hidden = visible.length > 0;
    $("resultSummary").textContent = `${visible.length} ${visible.length === 1 ? "obra encontrada" : "obras encontradas"}`;
    $("clientCount").textContent = Object.keys(state.clients).length;
    $("activeCount").textContent = all.filter((work) => work.situacao === "ANDAMENTO").length;
    $("referenceCount").textContent = Object.keys(state.registry).length || new Set(all.flatMap((work) => parseReferences(work.referencia))).size;
    $("clientSuggestions").innerHTML = Object.values(state.clients).map((client) => client.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")).map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  }

  function openWork(id = null) {
    const work = id ? state.works[id] : null;
    $("workForm").reset();
    $("workId").value = id || "";
    $("workDialogTitle").textContent = work ? "Editar obra" : "Nova obra";
    $("clientName").value = work ? clientName(work.clienteId) : "";
    $("workName").value = work?.nome || "";
    $("references").value = work?.referencia || "";
    $("workBranch").value = work?.filial || "FORTALEZA";
    $("workActive").checked = work ? work.situacao === "ANDAMENTO" : true;
    $("workContact").value = work?.contatoCliente || "";
    $("workAddress").value = work?.endereco || "";
    $("fixedEmployee").value = work?.funcionarioFixo || "";
    $("laboratoryType").value = work?.tipoLaboratorio || "";
    $("specimenSize").value = work?.tamanhoCp || "";
    $("specimenType").value = work?.tipoCp || "";
    $("pressId").value = work?.idPrensa || "";
    $("workObservations").value = work?.observacoes || "";
    $("formError").hidden = true;
    $("workDialog").showModal();
    setTimeout(() => $("clientName").focus(), 50);
  }

  function codeAt(index, length) {
    let result = "";
    for (let i = 0; i < length; i += 1) {
      result = String.fromCharCode(65 + (index % 26)) + result;
      index = Math.floor(index / 26);
    }
    return result;
  }

  function nextReference(extra = []) {
    const used = new Set([...Object.keys(state.registry), ...extra]);
    for (const length of [2, 3]) {
      for (let index = 0; index < 26 ** length; index += 1) {
        const candidate = codeAt(index, length);
        if (!used.has(candidate)) return candidate;
      }
    }
    throw new Error("Não há referências disponíveis.");
  }

  async function reserveReference(reference, workId) {
    const result = await db.ref(`referencias/${reference}`).transaction((current) => {
      if (current === null) return { obraId: workId, status: "ATIVA", primeiraUtilizacaoEm: now(), atualizadoEm: now() };
      if (current.obraId === workId) return { ...current, status: "ATIVA", atualizadoEm: now() };
      return;
    }, undefined, false);
    if (!result.committed) throw new Error(`A referência ${reference} já foi usada e não pode ser reutilizada.`);
  }

  function findClient(name) {
    const key = normalize(name);
    return Object.entries(state.clients).find(([, client]) => normalize(client.nome) === key);
  }

  async function ensureClient(name) {
    const existing = findClient(name);
    if (existing) return existing[0];
    const id = db.ref("clientes").push().key;
    const timestamp = now();
    await db.ref(`clientes/${id}`).set({ nome: name, nomeNormalizado: normalize(name), createdAt: timestamp, createdBy: state.user.uid, updatedAt: timestamp, updatedBy: state.user.uid });
    await writeAudit("CLIENTE", id, "CREATE");
    return id;
  }

  function compactWork(data) {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== "" && value !== undefined));
  }

  async function writeAudit(entity, entityId, action, changes) {
    const audit = { entidade: entity, entidadeId: entityId, acao: action, usuarioId: state.user.uid, usuarioEmail: state.user.email || state.profile.email || "", timestamp: now() };
    if (changes) audit.alteracoes = changes;
    await db.ref("auditoria").push(audit);
  }

  async function saveWork() {
    const id = $("workId").value || db.ref("obras").push().key;
    const previous = state.works[id];
    const client = $("clientName").value.trim();
    const name = $("workName").value.trim();
    const references = parseReferences($("references").value);
    if (!client || !name) return showFormError("Informe o cliente e o nome da obra.");
    if (!references.length) return showFormError("Informe pelo menos uma referência.");
    const previousReferences = parseReferences(previous?.referencia || "");
    const invalid = references.find((reference) => !validReference(reference) && !previousReferences.includes(reference));
    if (invalid) return showFormError(`A referência ${invalid} é inválida. Use somente 2 ou 3 letras.`);

    const button = $("saveButton");
    button.disabled = true;
    button.textContent = "Salvando...";
    $("formError").hidden = true;
    try {
      for (const reference of references) await reserveReference(reference, id);
      const clientId = await ensureClient(client);
      const timestamp = now();
      const work = compactWork({
        clienteId: clientId,
        nome: name,
        nomeNormalizado: normalize(name),
        referencia: references.join(", "),
        referenciaNormalizada: references.map(normalize).join(" "),
        tamanhoCp: $("specimenSize").value.trim(),
        tipoCp: $("specimenType").value.trim(),
        contatoCliente: $("workContact").value.trim(),
        endereco: $("workAddress").value.trim(),
        funcionarioFixo: $("fixedEmployee").value.trim(),
        tipoLaboratorio: $("laboratoryType").value.trim(),
        idPrensa: $("pressId").value.trim(),
        observacoes: $("workObservations").value.trim(),
        filial: $("workBranch").value,
        situacao: $("workActive").checked ? "ANDAMENTO" : "FINALIZADA",
        createdAt: previous?.createdAt || timestamp,
        createdBy: previous?.createdBy || state.user.uid,
        updatedAt: timestamp,
        updatedBy: state.user.uid
      });
      await db.ref(`obras/${id}`).set(work);
      const removed = parseReferences(previous?.referencia || "").filter((reference) => !references.includes(reference));
      await Promise.all(removed.map((reference) => db.ref(`referencias/${reference}`).update({ status: "RETIRADA", atualizadoEm: now() })));
      await writeAudit("OBRA", id, previous ? "UPDATE" : "CREATE");
      $("workDialog").close();
      toast("Obra salva com sucesso.");
    } catch (error) {
      showFormError(friendlyError(error));
    } finally {
      button.disabled = false;
      button.textContent = "Salvar obra";
    }
  }

  function showFormError(message) {
    $("formError").textContent = message;
    $("formError").hidden = false;
  }

  function askDelete(id) {
    const work = state.works[id];
    if (!work) return;
    state.deleteId = id;
    $("deleteMessage").textContent = `A obra “${work.nome}”, do cliente ${clientName(work.clienteId)}, deixará de aparecer nas consultas.`;
    $("deleteDialog").showModal();
  }

  async function deleteWork() {
    const work = state.works[state.deleteId];
    if (!work) return $("deleteDialog").close();
    const button = $("confirmDelete");
    button.disabled = true;
    button.textContent = "Excluindo...";
    try {
      await db.ref(`obras/${state.deleteId}`).update({ excluida: true, situacao: "FINALIZADA", updatedAt: now(), updatedBy: state.user.uid });
      await Promise.all(parseReferences(work.referencia).map((reference) => db.ref(`referencias/${reference}`).update({ status: "RETIRADA", atualizadoEm: now() })));
      await writeAudit("OBRA", state.deleteId, "DELETE");
      $("deleteDialog").close();
      toast("Obra excluída. As referências continuam reservadas.");
    } catch (error) {
      toast(friendlyError(error), true);
    } finally {
      button.disabled = false;
      button.textContent = "Excluir obra";
    }
  }

  function subscribe() {
    if (state.subscribed) return;
    state.subscribed = true;
    db.ref("clientes").on("value", (snapshot) => { state.clients = snapshot.val() || {}; render(); }, (error) => toast(friendlyError(error), true));
    db.ref("obras").on("value", (snapshot) => { state.works = snapshot.val() || {}; render(); }, (error) => toast(friendlyError(error), true));
    db.ref("referencias").on("value", (snapshot) => { state.registry = snapshot.val() || {}; render(); }, (error) => toast(friendlyError(error), true));
  }

  function unsubscribe() {
    if (!state.subscribed) return;
    ["clientes", "obras", "referencias"].forEach((path) => db.ref(path).off());
    state.subscribed = false;
  }

  function bind() {
    $("loginForm").addEventListener("submit", login);
    $("logoutButton").addEventListener("click", () => auth.signOut());
    $("newButton").addEventListener("click", () => openWork());
    $("saveButton").addEventListener("click", saveWork);
    $("confirmDelete").addEventListener("click", deleteWork);
    $("searchInput").addEventListener("input", render);
    $("statusFilter").addEventListener("change", render);
    $("resultsBody").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit]");
      const remove = event.target.closest("[data-delete]");
      if (edit) openWork(edit.dataset.edit);
      if (remove) askDelete(remove.dataset.delete);
    });
    $("suggestReference").addEventListener("click", () => {
      try {
        const current = parseReferences($("references").value);
        current.push(nextReference(current));
        $("references").value = current.join(", ");
      } catch (error) { showFormError(error.message); }
    });
    $("references").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9,;\s-]/g, ""); });
  }

  bind();
  auth.onAuthStateChanged(handleAuth);
})();
