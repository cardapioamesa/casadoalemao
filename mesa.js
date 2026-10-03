/* Pedido na mesa — Cardápio à Mesa
 *
 * O cliente senta na mesa, abre o QR dela (…/?mesa=3) e pede pelo celular.
 * O pedido chega no painel do dono, que confirma. Uma comanda por mesa: todos
 * os celulares da mesa somam na mesma conta, e só o dono fecha.
 *
 * Duas chaves precisam estar ligadas para o cliente ver o botão de pedir:
 *   pedidoNaMesa  — o dono liga e desliga no painel
 *   pedidoAte     — até quando está liberado; só o administrador muda
 * As duas são conferidas de novo pelas regras do Firestore, no servidor. O que
 * esta página faz é só mostrar a tela certa.
 *
 * Banco (a "unidade" é o próprio restaurante, ou uma loja da rede):
 *   restaurantes/{slug}                            { pedidoAte, pedidoNaMesa* }
 *   restaurantes/{slug}/lojas/{loja}               { nome, ..., pedidoNaMesa, esgotados[] }
 *   {unidade}/mesas/{id}                           { nome, ordem, comandaAberta }
 *   {unidade}/comandas/{id}                        { mesa, estado, abertaEm, fechadaEm, total }
 *   {unidade}/comandas/{id}/rodadas/{id}           { quem, itens[], estado, pedirTirar[], criadaEm }
 * * pedidoNaMesa fica no restaurante quando ele tem uma loja só.
 *
 * Rede com várias lojas: o QR da mesa leva a loja (…/?loja=itaipava&mesa=3)
 * e o pedido cai só no painel daquela loja. O gerente vê só a loja dele; o
 * escritório escolhe a loja no painel.
 */
(function(){
  "use strict";

  const API = window.CARDAPIO;
  if (!API || typeof window.firebase === "undefined") return;

  const CFG = API.cfg || {};
  const db = API.db, refRest = API.refRest, auth = API.auth, esc = API.esc;
  const FV = firebase.firestore.FieldValue;
  const unidade = loja => loja ? refRest.collection("lojas").doc(loja) : refRest;

  // lado do cliente: a loja e a mesa vêm do QR
  const PARAMS = new URLSearchParams(location.search);
  const LOJA = (PARAMS.get("loja") || "").trim();
  const refUnidadeC = unidade(LOJA);
  const refMesasC = refUnidadeC.collection("mesas");
  const refComandasC = refUnidadeC.collection("comandas");

  // lado do painel: a loja muda quando o escritório escolhe outra
  let lojaP = null;
  let refUnidadeP = refRest, refMesasP = refRest.collection("mesas"), refComandasP = refRest.collection("comandas");

  /* ---------------- utilidades ---------------- */
  const num = v => {
    const n = parseFloat(String(v == null ? "" : v).replace(/[^\d,.-]/g, "").replace(",", "."));
    return isFinite(n) ? n : 0;
  };
  const reais = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
  const hora = ts => (ts && ts.toDate) ? ts.toDate().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const dia = d => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const ordinal = i => (i + 1) + "º pedido";
  const totalRodada = r => (r.itens || []).reduce((s, i) => s + (i.qtd || 0) * num(i.preco), 0);
  const totalRodadas = rs => rs.reduce((s, r) => s + totalRodada(r), 0);

  const ESTADOS = {
    novo:     { dono: "Novo",       cliente: "Recebido" },
    preparo:  { dono: "Em preparo", cliente: "Na cozinha" },
    pronto:   { dono: "Pronto",     cliente: "Pronto" },
    entregue: { dono: "Na mesa",    cliente: "Na mesa" }
  };
  const rotulo = (r, lado) => (ESTADOS[r.estado] || ESTADOS.novo)[lado];

  function bip(){
    if (!comSom) return;
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      [0, .17].forEach((atraso, k) => {
        const o = a.createOscillator(), g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = "sine";
        o.frequency.value = k ? 1175 : 880;
        const t = a.currentTime + atraso;
        g.gain.setValueAtTime(.0001, t);
        g.gain.exponentialRampToValueAtTime(.25, t + .02);
        g.gain.exponentialRampToValueAtTime(.0001, t + .15);
        o.start(t); o.stop(t + .16);
      });
      setTimeout(() => a.close(), 900);
    } catch (e) { /* navegador sem áudio: segue sem som */ }
  }

  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const lembrar = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };

  /* ---------------- estado ---------------- */
  let conf = { ligado: false, ate: null };   // ligado: da unidade do cliente
  let ligadoP = false;                 // chave da unidade aberta no painel
  let esgotadosP = [];                 // esgotados do dia na loja do painel
  let mesas = [];                      // mesas da unidade do painel
  let mesaDoc = null;                  // documento da mesa deste QR
  const MESA = (PARAMS.get("mesa") || "").trim();

  let comanda = null;                  // comanda aberta da mesa (lado do cliente)
  let rodadas = [];                    // rodadas dela
  // declarados aqui em cima porque o primeiro snapshot pode chegar na hora
  let idComanda = null, pararComanda = null, pararRodadas = null;
  let carrinho = [];                   // [{id, nome, preco, qtd, obs}]
  let meuNome = lembrar("mesa-nome");
  let enviando = false;
  let folhaAberta = null;              // "item" | "comanda" | "cartaz"
  let itemAberto = null;
  let cartaz = null;                   // { url, blob, nome, arquivo } do cartaz na tela

  let comSom = lembrar("mesa-som") !== "0";
  let corpoPainel = null;              // onde o painel do dono desenha
  let comandasDono = [];               // comandas não fechadas
  let rodadasDono = {};                // id da comanda -> rodadas
  let pararDono = [];                  // listeners do painel
  let vistasRodadas = new Set();       // para tocar o som só em pedido novo
  let primeiraCarga = true;
  let caixa = null;                    // relatório calculado do dia
  let caixaCarregando = false;

  const prazoVale = () => !!(conf.ate && conf.ate.toMillis && conf.ate.toMillis() > Date.now());
  const liberado = () => conf.ligado && prazoVale();
  const diasRestantes = () => conf.ate && conf.ate.toMillis
    ? Math.ceil((conf.ate.toMillis() - Date.now()) / 86400000) : 0;
  const clienteAtivo = () => !!MESA && liberado() && !!mesaDoc;
  const nomeMesa = () => (mesaDoc && mesaDoc.nome) || MESA;

  /* -------- comanda da mesa (lado do cliente) -------- */

  function ouvirComanda(){
    if (!clienteAtivo()){
      if (pararComanda){ pararComanda(); pararComanda = null; }
      if (pararRodadas){ pararRodadas(); pararRodadas = null; }
      idComanda = null; comanda = null; rodadas = [];
      return;
    }
    const alvo = mesaDoc.comandaAberta || null;
    if (alvo === idComanda) return;

    if (pararComanda){ pararComanda(); pararComanda = null; }
    if (pararRodadas){ pararRodadas(); pararRodadas = null; }
    idComanda = alvo; comanda = null; rodadas = [];
    if (!alvo){ pintarCliente(); return; }

    pararComanda = refComandasC.doc(alvo).onSnapshot(s => {
      comanda = s.exists ? Object.assign({ id: s.id }, s.data()) : null;
      pintarCliente();
    }, () => {});

    pararRodadas = refComandasC.doc(alvo).collection("rodadas").orderBy("criadaEm").onSnapshot(qs => {
      rodadas = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
      pintarCliente();
    }, () => {});
  }

  /* ---------------- barra e folha do cliente ---------------- */
  const barra = document.createElement("div");
  barra.className = "mesa-bar";
  barra.id = "mesa-bar";
  barra.hidden = true;
  barra.innerHTML = `<div class="mesa-bar-in">
      <span class="mesa-chip" id="mesa-chip">Mesa</span>
      <span class="mesa-resumo" id="mesa-resumo"></span>
      <button class="mesa-bt" type="button" data-mesa-acao="ver-comanda" hidden id="mesa-ver">Comanda</button>
      <button class="mesa-bt forte" type="button" data-mesa-acao="enviar" id="mesa-enviar" disabled>Enviar pedido</button>
    </div>`;
  document.body.appendChild(barra);

  const folha = document.createElement("div");
  folha.className = "mesa-folha";
  folha.id = "mesa-folha";
  folha.hidden = true;
  document.body.appendChild(folha);

  function abrirFolha(modo){
    folhaAberta = modo;
    folha.hidden = false;
    document.body.classList.add("sem-rolagem");
    pintarFolha();
  }
  function fecharFolha(){
    folhaAberta = null; itemAberto = null;
    folha.hidden = true;
    document.body.classList.remove("sem-rolagem");
    if (cartaz){ try { URL.revokeObjectURL(cartaz.url); } catch (e) {} cartaz = null; }
  }

  function itemDoCardapio(id){
    const d = API.dados();
    return d ? d.itens.find(x => x.id === id) : null;
  }

  // As opções de preço de um item: uma só, ou duas quando a seção tem duas
  // colunas (pão careca ou brioche, simples ou especial) e o item tem as duas.
  function opcoesDe(it){
    const d = API.dados() || { secoes: [], itens: [] };
    const s = d.secoes.find(x => x.id === it.secao) || {};
    const col = Array.isArray(s.colunas) && s.colunas.length === 2 ? s.colunas : null;
    // nome repetido na seção (Café 60 ml e Café 120 ml): a etiqueta entra no
    // nome do pedido, senão a cozinha não sabe qual é
    const repetido = d.itens.some(x => x !== it && x.secao === it.secao && x.nome === it.nome);
    const nome = it.nome + (repetido && it.tag ? " · " + it.tag : "");
    if (col && it.preco2) return [
      { rotulo: col[0], nome: nome + " (" + col[0] + ")", preco: it.preco },
      { rotulo: col[1], nome: nome + " (" + col[1] + ")", preco: it.preco2 }
    ];
    return [{ rotulo: "", nome: nome, preco: it.preco }];
  }

  function pintarCliente(){
    const ativo = clienteAtivo();
    barra.hidden = !ativo;
    document.body.classList.toggle("com-mesa", ativo);
    if (!ativo){ if (folhaAberta && folhaAberta !== "cartaz") fecharFolha(); return; }

    document.getElementById("mesa-chip").textContent = "Mesa " + nomeMesa();
    const qtd = carrinho.reduce((s, i) => s + i.qtd, 0);
    const soma = carrinho.reduce((s, i) => s + i.qtd * i.preco, 0);
    const aberta = comanda && comanda.estado !== "fechada";
    document.getElementById("mesa-resumo").innerHTML = qtd
      ? `<b>${qtd} ${qtd === 1 ? "item" : "itens"} &middot; R$ ${reais(soma)}</b><span>${aberta ? "Entra na comanda da mesa" : "Confira e envie"}</span>`
      : (aberta
          ? `<b>Comanda aberta &middot; R$ ${reais(totalRodadas(rodadas))}</b><span>Toque num prato para pedir mais</span>`
          : `<b>Peça pelo celular</b><span>Toque num prato para começar</span>`);

    const bv = document.getElementById("mesa-ver");
    bv.hidden = !aberta;
    const be = document.getElementById("mesa-enviar");
    be.disabled = !qtd || enviando;
    be.textContent = enviando ? "Enviando…" : (aberta ? "Pedir mais" : "Enviar pedido");
    if (folhaAberta) pintarFolha();
  }

  function pintarFolha(){
    if (folhaAberta === "item") folha.innerHTML = folhaItem();
    else if (folhaAberta === "comanda") folha.innerHTML = folhaComanda();
    else if (folhaAberta === "cartaz") folha.innerHTML = folhaCartaz();
  }

  // O cartaz aparece na tela em vez de baixar direto: no iPhone o download de
  // imagem gerada não funciona, e daqui dá para salvar, compartilhar ou imprimir.
  function folhaCartaz(){
    if (!cartaz) return "";
    return `<div class="mesa-caixa" role="dialog" aria-modal="true" aria-label="Cartaz da mesa">
      <button class="mesa-x" type="button" data-mesa-acao="fechar-folha" aria-label="Fechar">&times;</button>
      <h3>Cartaz da mesa ${esc(cartaz.nome)}${lojaP ? " · " + esc(nomeDaLoja(lojaP)) : ""}</h3>
      <p class="mesa-desc">Imprima e deixe na mesa. Quem apontar a câmera cai no cardápio já nesta mesa.</p>
      <img class="mesa-cartaz" src="${esc(cartaz.url)}" alt="Cartaz com o QR Code da mesa ${esc(cartaz.nome)}">
      <div class="mesa-botoes">
        <button class="mesa-bt forte" type="button" data-mesa-acao="salvar-cartaz">${podeCompartilhar() ? "Salvar na galeria" : "Baixar o cartaz"}</button>
        <button class="mesa-bt" type="button" data-mesa-acao="imprimir-cartaz">Imprimir</button>
      </div>
      <p class="mesa-dica">Abre o menu do celular: escolha <strong>Salvar imagem</strong> (ou Adicionar às Fotos) e o cartaz vai para a galeria. Tocar e segurar na imagem acima faz o mesmo.</p>
    </div>`;
  }

  const podeCompartilhar = () => !!(navigator.canShare && window.File);

  function folhaItem(){
    const it = itemAberto && itemDoCardapio(itemAberto.id);
    if (!it) return "";
    const ops = opcoesDe(it);
    const op = ops[itemAberto.v] || ops[0];
    const preco = num(op.preco);
    const escolha = ops.length > 1
      ? `<div class="mesa-opcoes" role="radiogroup" aria-label="Escolha">${ops.map((o, i) => `
          <button class="mesa-opcao${i === itemAberto.v ? " marcada" : ""}" type="button" role="radio"
            aria-checked="${i === itemAberto.v}" data-mesa-acao="opcao" data-v="${i}">
            <span>${esc(o.rotulo)}</span><b>R$ ${esc(o.preco)}</b></button>`).join("")}
        </div>`
      : `<p class="mesa-preco">${op.preco ? "R$ " + esc(op.preco) : ""}</p>`;
    return `<div class="mesa-caixa" role="dialog" aria-modal="true" aria-label="${esc(it.nome)}">
      <button class="mesa-x" type="button" data-mesa-acao="fechar-folha" aria-label="Fechar">&times;</button>
      ${it.foto ? `<img class="mesa-foto" src="${esc(it.foto)}" alt="">` : ""}
      <h3>${esc(it.nome)}</h3>
      ${it.desc ? `<p class="mesa-desc">${esc(it.desc)}</p>` : ""}
      ${escolha}
      ${API.fora(it)
        ? `<p class="mesa-aviso">Esgotado hoje. Escolha outro prato.</p>`
        : !preco
        ? `<p class="mesa-aviso">Este item está sem preço no cardápio. Peça a quem estiver servindo.</p>`
        : `<div class="mesa-qtd">
            <button class="mesa-redondo" type="button" data-mesa-acao="menos" aria-label="Menos um">&minus;</button>
            <b id="mesa-q">${itemAberto.qtd}</b>
            <button class="mesa-redondo mais" type="button" data-mesa-acao="mais" aria-label="Mais um">+</button>
            <span class="mesa-subtotal">R$ ${reais(preco * itemAberto.qtd)}</span>
          </div>
          <label class="mesa-rotulo" for="mesa-obs">Observação (opcional)</label>
          <input class="mesa-campo" id="mesa-obs" type="text" maxlength="60" value="${esc(itemAberto.obs)}" placeholder="Ex.: sem cebola, pouco sal">
          <button class="mesa-bt forte larga" type="button" data-mesa-acao="add">Adicionar ao pedido</button>`}
    </div>`;
  }

  function folhaComanda(){
    if (!comanda) return "";
    const lista = rodadas.map((r, i) => {
      const itens = (r.itens || []).map((it, idx) => {
        const pedido = (r.pedirTirar || []).indexOf(idx) >= 0;
        return `<div class="mesa-linha${pedido ? " tirando" : ""}">
          <span class="mesa-q">${it.qtd}&times;</span>
          <span class="mesa-n">${esc(it.nome)}${it.obs ? `<small>${esc(it.obs)}</small>` : ""}</span>
          <span class="mesa-v">R$ ${reais(it.qtd * num(it.preco))}</span>
          ${pedido
            ? `<span class="mesa-esperando">pedido ao dono</span>`
            : `<button class="mesa-x-item" type="button" data-mesa-acao="pedir-tirar" data-rodada="${esc(r.id)}" data-idx="${idx}" aria-label="Pedir para tirar ${esc(it.nome)}">&times;</button>`}
        </div>`;
      }).join("");
      return `<div class="mesa-rodada">
        <div class="mesa-rodada-topo">
          <span class="mesa-rodada-nome">${ordinal(i)}${r.quem ? " &middot; " + esc(r.quem) : ""}${hora(r.criadaEm) ? " &middot; " + hora(r.criadaEm) : ""}</span>
          <span class="mesa-selo ${esc(r.estado || "novo")}">${esc(rotulo(r, "cliente"))}</span>
        </div>
        ${itens}
      </div>`;
    }).join("");

    return `<div class="mesa-caixa" role="dialog" aria-modal="true" aria-label="Comanda da mesa">
      <button class="mesa-x" type="button" data-mesa-acao="fechar-folha" aria-label="Fechar">&times;</button>
      <h3>Comanda da mesa ${esc(nomeMesa())}</h3>
      <p class="mesa-desc">${comanda.estado === "conta"
        ? "Conta pedida. Já estão indo até você."
        : "Tudo da mesa entra aqui, de qualquer celular. Para tirar um item, toque no × — quem tira é o dono."}</p>
      ${lista || `<p class="mesa-desc">Ainda não chegou nenhum pedido.</p>`}
      <div class="mesa-total">Total até agora<b>R$ ${reais(totalRodadas(rodadas))}</b></div>
      ${comanda.estado === "conta" ? "" : `<button class="mesa-bt larga" type="button" data-mesa-acao="pedir-conta">Pedir a conta</button>`}
    </div>`;
  }

  /* -------- cliques do cliente -------- */
  // Enquanto o pedido na mesa está ligado, tocar num prato abre a folha de
  // pedido em vez da foto ampliada. Por isso este ouvinte é de captura.
  document.addEventListener("click", e => {
    if (!clienteAtivo()) return;
    const alvo = e.target.closest("[data-item]");
    if (!alvo || alvo.closest(".admin") || alvo.closest(".mesa-folha")) return;
    const it = itemDoCardapio(alvo.dataset.item);
    if (!it) return;
    e.preventDefault();
    e.stopPropagation();
    itemAberto = { id: it.id, qtd: 1, obs: "", v: 0 };
    abrirFolha("item");
  }, true);

  document.addEventListener("click", async e => {
    const bt = e.target.closest("[data-mesa-acao]");
    if (e.target === folha){ fecharFolha(); return; }
    if (!bt) return;
    const acao = bt.dataset.mesaAcao;

    // ----- cliente -----
    if (acao === "fechar-folha"){ fecharFolha(); return; }
    if (acao === "mais" || acao === "menos"){
      if (!itemAberto) return;
      itemAberto.obs = (document.getElementById("mesa-obs") || {}).value || itemAberto.obs;
      itemAberto.qtd = Math.max(1, Math.min(30, itemAberto.qtd + (acao === "mais" ? 1 : -1)));
      pintarFolha(); return;
    }
    if (acao === "opcao"){
      if (!itemAberto) return;
      itemAberto.obs = (document.getElementById("mesa-obs") || {}).value || itemAberto.obs;
      itemAberto.v = Number(bt.dataset.v) || 0;
      pintarFolha(); return;
    }
    if (acao === "add"){
      const it = itemDoCardapio(itemAberto.id);
      if (!it) return;
      const ops = opcoesDe(it);
      const op = ops[itemAberto.v] || ops[0];
      const qtd = itemAberto.qtd;
      const obs = ((document.getElementById("mesa-obs") || {}).value || "").trim();
      const igual = carrinho.find(x => x.id === it.id && x.nome === op.nome && x.obs === obs);
      if (igual) igual.qtd += qtd;
      else carrinho.push({ id: it.id, nome: op.nome, preco: num(op.preco), qtd: qtd, obs: obs });
      fecharFolha();
      pintarCliente();
      API.avisar(qtd + "× " + op.nome + " no pedido.");
      return;
    }
    if (acao === "ver-comanda"){ abrirFolha("comanda"); return; }
    if (acao === "salvar-cartaz"){ salvarCartaz(); return; }
    if (acao === "imprimir-cartaz"){ imprimirCartaz(); return; }
    if (acao === "enviar"){ enviarPedido(); return; }
    if (acao === "pedir-conta"){
      try {
        await refComandasC.doc(comanda.id).update({ estado: "conta" });
        API.avisar("Pedido de conta enviado. Já estão indo até você.");
      } catch (err) { API.avisar("Não deu para pedir a conta agora.", true); }
      return;
    }
    if (acao === "pedir-tirar"){
      const idx = Number(bt.dataset.idx);
      try {
        await refComandasC.doc(comanda.id).collection("rodadas").doc(bt.dataset.rodada)
          .update({ pedirTirar: FV.arrayUnion(idx) });
        API.avisar("Pedido enviado ao dono. Ele confirma a retirada.");
      } catch (err) { API.avisar("Não deu para pedir agora. Chame alguém da casa.", true); }
      return;
    }

    // ----- dono -----
    if (acao && acao.indexOf("dono-") === 0) acaoDono(acao.slice(5), bt);
  });

  async function enviarPedido(){
    if (!carrinho.length || enviando) return;
    if (!meuNome){
      const n = window.prompt("Seu nome (opcional) — ajuda a casa a saber de quem é cada prato:", "");
      if (n === null) return;
      meuNome = n.trim().slice(0, 30);
      guardar("mesa-nome", meuNome);
    }
    enviando = true; pintarCliente();
    const itens = carrinho.map(i => ({ nome: i.nome, preco: i.preco, qtd: i.qtd, obs: i.obs || "" }));
    try {
      await db.runTransaction(async tx => {
        const mref = refMesasC.doc(MESA);
        const msnap = await tx.get(mref);
        if (!msnap.exists) throw new Error("mesa");
        let cid = msnap.data().comandaAberta || null;
        if (cid){
          const c = await tx.get(refComandasC.doc(cid));
          if (!c.exists || c.data().estado === "fechada") cid = null;
        }
        if (!cid){
          const nova = refComandasC.doc();
          tx.set(nova, { mesa: MESA, estado: "aberta", abertaEm: FV.serverTimestamp() });
          tx.update(mref, { comandaAberta: nova.id });
          cid = nova.id;
        }
        tx.set(refComandasC.doc(cid).collection("rodadas").doc(), {
          quem: meuNome, itens: itens, estado: "novo", pedirTirar: [], criadaEm: FV.serverTimestamp()
        });
      });
      carrinho = [];
      API.avisar("Pedido enviado. A casa vai confirmar.");
      abrirFolha("comanda");
    } catch (err) {
      console.error("Falha ao enviar o pedido:", err);
      API.avisar(err && err.code === "permission-denied"
        ? "O pedido pela mesa está fora do ar. Chame alguém da casa."
        : "Não deu para enviar agora. Tente de novo.", true);
    } finally {
      enviando = false;
      pintarCliente();
    }
  }

  /* ---------------- painel do dono ---------------- */
  function ligarPainel(){
    if (pararDono.length || !API.ehDono()) return;
    pararDono.push(refComandasP.where("estado", "!=", "fechada").onSnapshot(qs => {
      comandasDono = qs.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => (a.abertaEm && a.abertaEm.toMillis ? a.abertaEm.toMillis() : 0) -
                        (b.abertaEm && b.abertaEm.toMillis ? b.abertaEm.toMillis() : 0));
      sincronizarRodadas();
      pintarPainel();
    }, err => console.warn("comandas:", err)));
  }

  function desligarPainel(){
    pararDono.forEach(f => { try { f(); } catch (e) {} });
    pararDono = [];
    Object.keys(ouvintesRodada).forEach(id => { ouvintesRodada[id](); delete ouvintesRodada[id]; });
    comandasDono = []; rodadasDono = {}; primeiraCarga = true; vistasRodadas = new Set();
  }

  const ouvintesRodada = {};
  function sincronizarRodadas(){
    const vivas = new Set(comandasDono.map(c => c.id));
    Object.keys(ouvintesRodada).forEach(id => {
      if (!vivas.has(id)){ ouvintesRodada[id](); delete ouvintesRodada[id]; delete rodadasDono[id]; }
    });
    comandasDono.forEach(c => {
      if (ouvintesRodada[c.id]) return;
      ouvintesRodada[c.id] = refComandasP.doc(c.id).collection("rodadas").orderBy("criadaEm").onSnapshot(qs => {
        rodadasDono[c.id] = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
        let novidade = false;
        rodadasDono[c.id].forEach(r => {
          const chave = c.id + "/" + r.id;
          if (!vistasRodadas.has(chave)){
            vistasRodadas.add(chave);
            if (!primeiraCarga && r.estado === "novo") novidade = true;
          }
        });
        if (novidade) bip();
        pintarPainel();
      }, err => console.warn("rodadas:", err));
    });
    setTimeout(() => { primeiraCarga = false; }, 1500);
  }

  function aposAdmin(container){
    corpoPainel = document.createElement("div");
    corpoPainel.id = "mesa-painel";
    container.insertBefore(corpoPainel, container.firstChild);
    // qual loja o painel mostra: a do gerente; para o escritório, a última
    // escolhida neste aparelho (ou a primeira da lista)
    const lojas = API.lojas();
    const papel = API.papel() || {};
    let alvo = null;
    if (lojas.length){
      if (papel.loja) alvo = papel.loja;
      else {
        const lembrada = lembrar("mesa-loja");
        alvo = lojas.some(l => l.id === lembrada) ? lembrada : lojas[0].id;
      }
    }
    if (alvo !== lojaP || !pararUnidade.length) trocarLoja(alvo);
    else { ligarPainel(); pintarPainel(); }
  }

  // Troca a unidade do painel: desliga os ouvintes da loja anterior e liga os
  // da nova. Sem lojas, a unidade é o próprio restaurante.
  let pararUnidade = [];
  function trocarLoja(id){
    desligarPainel();
    pararUnidade.forEach(f => { try { f(); } catch (e) {} });
    pararUnidade = [];
    lojaP = id || null;
    refUnidadeP = unidade(lojaP);
    refMesasP = refUnidadeP.collection("mesas");
    refComandasP = refUnidadeP.collection("comandas");
    mesas = []; caixa = null;
    if (lojaP){
      pararUnidade.push(refUnidadeP.onSnapshot(s => {
        const d = (s && s.data()) || {};
        ligadoP = !!d.pedidoNaMesa;
        esgotadosP = Array.isArray(d.esgotados) ? d.esgotados : [];
        pintarPainel();
      }, () => {}));
    }
    pararUnidade.push(refMesasP.orderBy("ordem").onSnapshot(qs => {
      mesas = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
      pintarPainel();
    }, () => {}));
    ligarPainel();
    pintarPainel();
  }

  const nomeDaLoja = id => {
    const l = API.lojas().find(x => x.id === id);
    return (l && l.nome) || id || "";
  };

  function pintarPainel(){
    if (!corpoPainel || !corpoPainel.isConnected || !API.ehDono()) return;
    corpoPainel.innerHTML = blocoLoja() + blocoChave() + blocoEsgotados() + blocoPedidos() + blocoMesas() + blocoCaixa();
  }

  // Escolha da loja (só para o escritório; o gerente vê o nome da loja dele).
  function blocoLoja(){
    const lojas = API.lojas();
    if (!lojas.length || !lojaP) return "";
    const papel = API.papel() || {};
    if (papel.loja) return `<div class="aviso">Você está no painel da loja <strong>${esc(nomeDaLoja(lojaP))}</strong>.</div>`;
    return `<div class="bloco mesa-loja-bloco">
      <h3>Loja</h3>
      <p class="dica">Pedidos, mesas, esgotados e caixa abaixo são desta loja. O cardápio, mais embaixo, vale para todas.</p>
      <select class="mesa-campo" id="mesa-loja" aria-label="Loja">
        ${lojas.map(l => `<option value="${esc(l.id)}" ${l.id === lojaP ? "selected" : ""}>${esc(l.nome || l.id)}</option>`).join("")}
      </select>
    </div>`;
  }

  // O que acabou hoje NESTA loja. Grava na hora, sem precisar publicar.
  function blocoEsgotados(){
    if (!lojaP) return "";
    const d = API.dados();
    if (!d) return "";
    const marcados = new Set(esgotadosP);
    const grupos = d.secoes.filter(s => s.estilo !== "quadro").map(s => {
      const itens = d.itens.filter(i => i.secao === s.id);
      if (!itens.length) return "";
      const n = itens.filter(i => marcados.has(i.id)).length;
      return `<details class="mesa-esg-grupo"${n ? " open" : ""}>
        <summary>${esc(s.nome)}${n ? ` <span class="mesa-contador tem">${n} esgotado${n > 1 ? "s" : ""}</span>` : ""}</summary>
        <div class="mesa-esg-lista">${itens.map(i => `<button type="button" class="mesa-esg${marcados.has(i.id) ? " fora" : ""}"
            data-mesa-acao="dono-esgotar" data-id="${esc(i.id)}" aria-pressed="${marcados.has(i.id)}">${esc(i.nome)}${i.tag ? ` <small>${esc(i.tag)}</small>` : ""}</button>`).join("")}</div>
      </details>`;
    }).join("");
    return `<div class="bloco">
      <h3>Esgotou hoje nesta loja
        <span class="mesa-contador${marcados.size ? " tem" : ""}">${marcados.size ? marcados.size + " esgotado" + (marcados.size > 1 ? "s" : "") : "nada esgotado"}</span>
      </h3>
      <p class="dica">Toque no item que acabou: ele aparece como "esgotado hoje" só para quem está nesta loja. Toque de novo quando voltar. Vale na hora, sem publicar.</p>
      ${marcados.size ? `<div class="linha-acoes" style="justify-content:flex-start;margin-bottom:12px"><button class="bt mini-bt" type="button" data-mesa-acao="dono-esgotar-limpar">Voltou tudo</button></div>` : ""}
      ${grupos}
    </div>`;
  }

  function blocoChave(){
    const ehAdmin = auth.currentUser && CFG.admin && auth.currentUser.uid === CFG.admin;
    const dias = diasRestantes();
    let estado;
    if (!conf.ate) estado = `<p class="mesa-status ruim">Ainda não liberado. Fale com o Cardápio à Mesa.</p>`;
    else if (conf.ate.toMillis() <= Date.now())
      estado = `<p class="mesa-status ruim">Período encerrado em ${esc(dia(conf.ate.toDate()))}. Fale com o Cardápio à Mesa para continuar usando.</p>`;
    else
      estado = `<p class="mesa-status">Liberado até <strong>${esc(dia(conf.ate.toDate()))}</strong> — ${dias} dia${dias === 1 ? "" : "s"} restante${dias === 1 ? "" : "s"}.</p>`;

    const podeLigar = prazoVale();
    const hoje = new Date();
    const emTrinta = new Date(hoje.getTime() + 30 * 86400000).toISOString().slice(0, 10);

    return `<div class="bloco">
      <h3>Pedido na mesa${lojaP ? " · " + esc(nomeDaLoja(lojaP)) : ""}</h3>
      <p class="dica">Desligado, o cardápio fica igual ao de sempre: o cliente vê os pratos e não pede pelo celular.${lojaP ? " A chave vale só para esta loja." : ""}</p>
      <div class="mesa-chave">
        <button class="mesa-interruptor${ligadoP ? " ligado" : ""}" type="button" role="switch"
          aria-checked="${ligadoP}" data-mesa-acao="dono-chave" ${podeLigar ? "" : "disabled"}>
          <span class="mesa-bolinha"></span>
        </button>
        <b>${ligadoP ? "Recebendo pedidos pela mesa" : "Pedido pela mesa desligado"}</b>
      </div>
      ${estado}
      ${ehAdmin ? `<div class="mesa-admin">
        <p class="dica">Administrador do Cardápio à Mesa: até quando este restaurante pode receber pedido pela mesa.</p>
        <div class="mesa-linha-campo">
          <input class="mesa-campo" type="date" id="mesa-ate" value="${conf.ate ? esc(conf.ate.toDate().toISOString().slice(0,10)) : esc(emTrinta)}">
          <button class="bt" type="button" data-mesa-acao="dono-liberar">Salvar liberação</button>
          <button class="bt" type="button" data-mesa-acao="dono-trinta">30 dias a partir de hoje</button>
        </div>
      </div>` : ""}
    </div>`;
  }

  function blocoPedidos(){
    if (!conf.ate) return "";
    const novos = comandasDono.reduce((s, c) => s + (rodadasDono[c.id] || []).filter(r => r.estado === "novo").length, 0);
    const trocas = comandasDono.reduce((s, c) => s + (rodadasDono[c.id] || [])
      .reduce((t, r) => t + (r.pedirTirar || []).length, 0), 0);

    const cartoes = comandasDono.map(c => {
      const rs = rodadasDono[c.id] || [];
      const temNovo = rs.some(r => r.estado === "novo");
      const corpo = rs.map((r, i) => {
        const itens = (r.itens || []).map((it, idx) => {
          const pedido = (r.pedirTirar || []).indexOf(idx) >= 0;
          return `<div class="mesa-linha${pedido ? " tirando" : ""}">
              <span class="mesa-q">${it.qtd}&times;</span>
              <span class="mesa-n">${esc(it.nome)}${it.obs ? `<small>&#9998; ${esc(it.obs)}</small>` : ""}</span>
              <span class="mesa-v">R$ ${reais(it.qtd * num(it.preco))}</span>
            </div>
            ${pedido ? `<div class="mesa-pediu">
              <span>A mesa pediu para tirar <strong>${esc(it.nome)}</strong></span>
              <button class="bt mini-bt perigo" type="button" data-mesa-acao="dono-tirar" data-c="${esc(c.id)}" data-r="${esc(r.id)}" data-idx="${idx}">Tirar da comanda</button>
              <button class="bt mini-bt" type="button" data-mesa-acao="dono-manter" data-c="${esc(c.id)}" data-r="${esc(r.id)}" data-idx="${idx}">Manter</button>
            </div>` : ""}`;
        }).join("");
        let acoes = "";
        if (r.estado === "novo") acoes = `<button class="bt forte mini-bt" type="button" data-mesa-acao="dono-aceitar" data-c="${esc(c.id)}" data-r="${esc(r.id)}">Aceitar</button>
          <button class="bt mini-bt perigo" type="button" data-mesa-acao="dono-recusar" data-c="${esc(c.id)}" data-r="${esc(r.id)}">Recusar</button>`;
        else if (r.estado === "preparo") acoes = `<button class="bt mini-bt" type="button" data-mesa-acao="dono-pronto" data-c="${esc(c.id)}" data-r="${esc(r.id)}">Pronto</button>`;
        else if (r.estado === "pronto") acoes = `<button class="bt mini-bt" type="button" data-mesa-acao="dono-entregue" data-c="${esc(c.id)}" data-r="${esc(r.id)}">Entreguei na mesa</button>`;
        return `<div class="mesa-rodada">
          <div class="mesa-rodada-topo">
            <span class="mesa-rodada-nome">${ordinal(i)}${r.quem ? " &middot; " + esc(r.quem) : ""}${hora(r.criadaEm) ? " &middot; " + hora(r.criadaEm) : ""}</span>
            <span class="mesa-selo ${esc(r.estado || "novo")}">${esc(rotulo(r, "dono"))}</span>
          </div>
          ${itens}
          ${acoes ? `<div class="linha-acoes" style="justify-content:flex-start;margin-top:10px">${acoes}</div>` : ""}
        </div>`;
      }).join("");

      const quem = [...new Set(rs.map(r => r.quem).filter(Boolean))].join(", ");
      return `<div class="mesa-comanda${temNovo ? " nova" : ""}">
        <div class="mesa-comanda-topo">
          <span class="mesa-comanda-nome">Mesa ${esc(nomeDaMesa(c.mesa))}${quem ? " &middot; " + esc(quem) : ""}</span>
          <span class="mesa-comanda-hora">desde ${esc(hora(c.abertaEm) || "agora")}</span>
          <span class="mesa-selo ${c.estado === "conta" ? "novo" : (temNovo ? "novo" : "preparo")}">${c.estado === "conta" ? "Pediu a conta" : (temNovo ? "Pedido novo" : "Aberta")}</span>
        </div>
        ${corpo || `<p class="dica">Sem pedidos nesta comanda.</p>`}
        <div class="mesa-total">Total até agora<b>R$ ${reais(totalRodadas(rs))}</b></div>
        <div class="linha-acoes" style="justify-content:flex-start;margin-top:10px">
          <button class="bt" type="button" data-mesa-acao="dono-fechar" data-c="${esc(c.id)}">Fechar conta</button>
        </div>
      </div>`;
    }).join("");

    return `<div class="bloco">
      <h3>Pedidos
        <span class="mesa-contador${novos || trocas ? " tem" : ""}">${novos ? novos + " novo" + (novos > 1 ? "s" : "")
          : trocas ? trocas + " para tirar"
          : comandasDono.length ? comandasDono.length + " aberta" + (comandasDono.length > 1 ? "s" : "") : "nenhuma aberta"}</span>
      </h3>
      <p class="dica">Deixe esta tela aberta durante o serviço. <button class="bt mini-bt" type="button" data-mesa-acao="dono-som">${comSom ? "&#128276; som ligado" : "&#128277; som desligado"}</button></p>
      ${cartoes || `<p class="dica">Nenhuma comanda aberta. Quando alguém pedir pela mesa, ela aparece aqui.</p>`}
    </div>`;
  }

  const nomeDaMesa = id => {
    const m = mesas.find(x => x.id === id);
    return (m && m.nome) || id;
  };

  function blocoMesas(){
    const linhas = mesas.map((m, i) => `<div class="linha-item">
      <span class="linha-corpo">
        <span class="linha-nome">Mesa ${esc(m.nome || m.id)}</span>
        <span class="linha-sub">${m.comandaAberta ? "comanda aberta agora" : "livre"}</span>
      </span>
      <span class="linha-acoes">
        <button class="bt mini-bt" type="button" data-mesa-acao="dono-qr" data-m="${esc(m.id)}">Cartaz QR</button>
        <button class="bt mini-bt" type="button" data-mesa-acao="dono-mesa-nome" data-m="${esc(m.id)}">Renomear</button>
        <button class="bt mini-bt perigo" type="button" data-mesa-acao="dono-mesa-tirar" data-m="${esc(m.id)}">Excluir</button>
      </span>
    </div>`).join("");

    return `<div class="bloco">
      <h3>Mesas</h3>
      <p class="dica">Cada mesa tem o seu cartaz com QR Code. Acrescente quantas quiser, quando quiser.</p>
      ${linhas || `<p class="dica">Nenhuma mesa cadastrada ainda.</p>`}
      <div class="linha-acoes" style="justify-content:flex-start;margin-top:14px">
        <button class="bt forte" type="button" data-mesa-acao="dono-mesa-nova">+ Nova mesa</button>
      </div>
    </div>`;
  }

  function blocoCaixa(){
    let corpo;
    if (caixaCarregando) corpo = `<p class="dica">Somando o dia…</p>`;
    else if (!caixa) corpo = `<p class="dica">Some as comandas fechadas de hoje para o fechamento do caixa.</p>`;
    else if (!caixa.comandas.length) corpo = `<p class="dica">Nenhuma comanda fechada hoje ainda.</p>`;
    else corpo = `<div class="mesa-caixa-total">
        <span>${caixa.comandas.length} comanda${caixa.comandas.length > 1 ? "s" : ""} fechada${caixa.comandas.length > 1 ? "s" : ""}<br>Ticket médio por mesa: R$ ${reais(caixa.total / caixa.comandas.length)}</span>
        <b>R$ ${reais(caixa.total)}</b>
      </div>
      <h4>O que saiu</h4>
      ${caixa.itens.map(([nome, e]) => `<div class="mesa-linha">
        <span class="mesa-n">${esc(nome)} <small>×${e.qtd}</small></span>
        <span class="mesa-v">R$ ${reais(e.valor)}</span>
      </div>`).join("")}
      <h4>Mesa por mesa</h4>
      ${caixa.comandas.map(c => `<div class="mesa-linha">
        <span class="mesa-n">Mesa ${esc(nomeDaMesa(c.mesa))} <small>${esc(hora(c.abertaEm))} → ${esc(hora(c.fechadaEm))}</small></span>
        <span class="mesa-v">R$ ${reais(c.total)}</span>
      </div>`).join("")}
      <p class="dica" style="margin-top:12px">${comandasDono.length
        ? comandasDono.length + " comanda" + (comandasDono.length > 1 ? "s" : "") + " ainda aberta" + (comandasDono.length > 1 ? "s" : "") + " — não entra no fechamento."
        : "Nenhuma comanda aberta. Pode fechar o caixa."}</p>
      <p class="dica">Controle interno da casa: não substitui nota nem cupom fiscal.</p>`;

    return `<div class="bloco">
      <h3>Caixa do dia</h3>
      <div class="linha-acoes" style="justify-content:flex-start;margin-bottom:12px">
        <button class="bt" type="button" data-mesa-acao="dono-caixa">${caixa ? "Atualizar" : "Somar o dia de hoje"}</button>
      </div>
      ${corpo}
    </div>`;
  }

  /* -------- ações do dono -------- */
  async function acaoDono(acao, bt){
    const cid = bt.dataset.c, rid = bt.dataset.r, mid = bt.dataset.m;
    const idx = bt.dataset.idx === undefined ? null : Number(bt.dataset.idx);
    const rodada = () => (rodadasDono[cid] || []).find(r => r.id === rid);
    const refR = () => refComandasP.doc(cid).collection("rodadas").doc(rid);

    try {
      if (acao === "chave"){
        await refUnidadeP.update({ pedidoNaMesa: !ligadoP });
        return;
      }
      if (acao === "esgotar"){
        const id = bt.dataset.id;
        const fora = esgotadosP.indexOf(id) >= 0;
        await refUnidadeP.update({ esgotados: fora ? FV.arrayRemove(id) : FV.arrayUnion(id) });
        return;
      }
      if (acao === "esgotar-limpar"){
        if (!window.confirm("Marcar tudo como disponível de novo nesta loja?")) return;
        await refUnidadeP.update({ esgotados: [] });
        return;
      }
      if (acao === "som"){
        comSom = !comSom;
        guardar("mesa-som", comSom ? "1" : "0");
        if (comSom) bip();
        pintarPainel();
        return;
      }
      if (acao === "liberar" || acao === "trinta"){
        let data;
        if (acao === "trinta") data = new Date(Date.now() + 30 * 86400000);
        else {
          const v = (document.getElementById("mesa-ate") || {}).value;
          if (!v) return;
          data = new Date(v + "T23:59:59");
        }
        await refRest.update({ pedidoAte: firebase.firestore.Timestamp.fromDate(data) });
        API.avisar("Liberado até " + dia(data) + ".");
        return;
      }
      if (acao === "aceitar")  { await refR().update({ estado: "preparo" });  return; }
      if (acao === "pronto")   { await refR().update({ estado: "pronto" });   return; }
      if (acao === "entregue") { await refR().update({ estado: "entregue" }); return; }
      if (acao === "recusar"){
        if (!window.confirm("Recusar este pedido? Ele sai da comanda.")) return;
        await refR().delete();
        return;
      }
      if (acao === "manter"){
        const r = rodada();
        if (!r) return;
        await refR().update({ pedirTirar: (r.pedirTirar || []).filter(x => x !== idx) });
        return;
      }
      if (acao === "tirar"){
        const r = rodada();
        if (!r) return;
        const itens = (r.itens || []).filter((x, i) => i !== idx);
        if (!itens.length){
          if (!window.confirm("Era o único item deste pedido. Tirar o pedido inteiro?")) return;
          await refR().delete();
          return;
        }
        // os índices andam para trás quando um item sai do meio da lista
        const restam = (r.pedirTirar || []).filter(x => x !== idx).map(x => x > idx ? x - 1 : x);
        await refR().update({ itens: itens, pedirTirar: restam });
        return;
      }
      if (acao === "fechar"){
        const rs = rodadasDono[cid] || [];
        if (!window.confirm("Fechar a conta desta mesa? Total: R$ " + reais(totalRodadas(rs)))) return;
        const c = comandasDono.find(x => x.id === cid);
        const lote = db.batch();
        lote.update(refComandasP.doc(cid), {
          estado: "fechada", fechadaEm: FV.serverTimestamp(), total: totalRodadas(rs)
        });
        if (c && mesas.some(m => m.id === c.mesa && m.comandaAberta === cid))
          lote.update(refMesasP.doc(c.mesa), { comandaAberta: null });
        await lote.commit();
        caixa = null;
        API.avisar("Conta fechada.");
        return;
      }
      if (acao === "mesa-nova"){
        const n = (window.prompt("Número ou nome da mesa (ex.: 1, 2, balcão):", String(mesas.length + 1)) || "").trim();
        if (!n) return;
        const id = n.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 20);
        if (!id){ API.avisar("Use números ou letras no nome da mesa.", true); return; }
        if (mesas.some(m => m.id === id)){ API.avisar("Já existe uma mesa com esse nome.", true); return; }
        await refMesasP.doc(id).set({ nome: n, ordem: mesas.length, comandaAberta: null });
        API.avisar("Mesa " + n + " criada. Baixe o cartaz com o QR dela.");
        return;
      }
      if (acao === "mesa-nome"){
        const m = mesas.find(x => x.id === mid);
        const n = (window.prompt("Nome que aparece no cartaz e no painel:", m ? (m.nome || m.id) : "") || "").trim();
        if (!n) return;
        await refMesasP.doc(mid).update({ nome: n });
        return;
      }
      if (acao === "mesa-tirar"){
        const m = mesas.find(x => x.id === mid);
        if (m && m.comandaAberta){ API.avisar("Feche a conta desta mesa antes de excluir.", true); return; }
        if (!window.confirm("Excluir a mesa " + (m ? (m.nome || m.id) : mid) + "? O QR dela para de funcionar.")) return;
        await refMesasP.doc(mid).delete();
        return;
      }
      if (acao === "qr"){ cartazDaMesa(mesas.find(x => x.id === mid)); return; }
      if (acao === "caixa"){ await somarCaixa(); return; }
    } catch (err) {
      console.error("Painel do pedido na mesa:", err);
      API.avisar(err && err.code === "permission-denied"
        ? "Esta conta não tem permissão para isso."
        : "Não deu para fazer isso agora. Tente de novo.", true);
    }
  }

  /* -------- caixa do dia -------- */
  async function somarCaixa(){
    caixaCarregando = true; pintarPainel();
    try {
      const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
      const qs = await refComandasP.where("fechadaEm", ">=", firebase.firestore.Timestamp.fromDate(inicio)).get();
      const comandas = [];
      const porItem = {};
      for (const d of qs.docs){
        const c = Object.assign({ id: d.id }, d.data());
        if (c.estado !== "fechada") continue;
        const rs = await refComandasP.doc(c.id).collection("rodadas").get();
        let total = 0;
        rs.docs.forEach(x => {
          const r = x.data();
          (r.itens || []).forEach(it => {
            const v = it.qtd * num(it.preco);
            total += v;
            const e = porItem[it.nome] || (porItem[it.nome] = { qtd: 0, valor: 0 });
            e.qtd += it.qtd; e.valor += v;
          });
        });
        c.total = total;
        comandas.push(c);
      }
      comandas.sort((a, b) => (a.fechadaEm && a.fechadaEm.toMillis ? a.fechadaEm.toMillis() : 0) -
                              (b.fechadaEm && b.fechadaEm.toMillis ? b.fechadaEm.toMillis() : 0));
      caixa = {
        comandas: comandas,
        total: comandas.reduce((s, c) => s + c.total, 0),
        itens: Object.entries(porItem).sort((a, b) => b[1].valor - a[1].valor)
      };
    } catch (err) {
      console.error("Caixa do dia:", err);
      API.avisar("Não deu para somar o caixa agora.", true);
    } finally {
      caixaCarregando = false;
      pintarPainel();
    }
  }

  /* -------- cartaz com o QR da mesa -------- */
  function cartazDaMesa(m){
    if (!m) return;
    const d = API.dados() || {};
    const site = d.site || {};
    const base = (site.url || (location.origin + location.pathname)).trim().replace(/[?#].*$/, "");
    const url = base + (lojaP ? "?loja=" + encodeURIComponent(lojaP) + "&mesa=" : "?mesa=") + encodeURIComponent(m.id);
    if (typeof window.QRCode === "undefined"){ API.avisar("Sem internet para gerar o QR agora.", true); return; }

    const oculto = document.createElement("div");
    oculto.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(oculto);
    try { new window.QRCode(oculto, { text: url, width: 520, height: 520, correctLevel: window.QRCode.CorrectLevel.M }); }
    catch (e) { oculto.remove(); API.avisar("Não deu para gerar o QR.", true); return; }

    setTimeout(() => {
      const fonte = oculto.querySelector("canvas") || oculto.querySelector("img");
      if (!fonte){ oculto.remove(); API.avisar("Não deu para gerar o QR.", true); return; }
      const c = document.createElement("canvas");
      c.width = 760; c.height = 1040;
      const g = c.getContext("2d");
      g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, c.width, c.height);
      // a fita vermelha e verde da marca, no alto do cartaz
      g.fillStyle = "#C8102E"; g.fillRect(0, 0, c.width / 2, 16);
      g.fillStyle = "#0B5D35"; g.fillRect(c.width / 2, 0, c.width / 2, 16);
      g.fillStyle = "#2D2A26";
      g.textAlign = "center";
      g.font = "600 34px Georgia, serif";
      g.fillText((site.nome || "Cardápio").toUpperCase() + (lojaP ? " · " + nomeDaLoja(lojaP).toUpperCase() : ""), 380, 92, 700);
      g.font = "700 104px Arial, sans-serif";
      g.fillText("MESA " + String(m.nome || m.id).toUpperCase(), 380, 210);
      try { g.drawImage(fonte, 120, 270, 520, 520); } catch (e) {}
      g.fillStyle = "#C8102E";
      g.fillRect(230, 838, 300, 4);
      g.fillStyle = "#2D2A26";
      g.font = "600 30px Arial, sans-serif";
      g.fillText("Aponte a câmera do celular", 380, 900);
      g.fillText("para ver o cardápio e pedir", 380, 940);
      g.fillStyle = "#968B7F";
      g.font = "22px Arial, sans-serif";
      g.fillText("Cardápio à Mesa", 380, 1000);
      oculto.remove();
      mostrarCartaz(c, m);
    }, 80);
  }

  // O cartaz vai para a tela: no celular, baixar imagem feita na hora não
  // funciona (o iPhone ignora), mas dali dá para salvar, compartilhar ou imprimir.
  function mostrarCartaz(c, m){
    const nome = String(m.nome || m.id);
    const arquivo = (lojaP ? lojaP + "-" : "") + "mesa-" + m.id + ".png";
    // Monta o arquivo na hora, sem toBlob: assim funciona igual em todo
    // navegador e nada fica esperando um aviso que pode não vir.
    try {
      const base = c.toDataURL("image/png").split(",")[1];
      const bin = atob(base), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: "image/png" });
      if (cartaz){ try { URL.revokeObjectURL(cartaz.url); } catch (e) {} }
      cartaz = { url: URL.createObjectURL(blob), blob: blob, nome: nome, arquivo: arquivo };
      abrirFolha("cartaz");
    } catch (e) {
      API.avisar("Não deu para montar o cartaz neste aparelho.", true);
    }
  }

  async function salvarCartaz(){
    if (!cartaz) return;
    const titulo = "Cartaz da mesa " + cartaz.nome;
    if (podeCompartilhar()){
      try {
        const f = new File([cartaz.blob], cartaz.arquivo, { type: "image/png" });
        if (navigator.canShare({ files: [f] })){
          await navigator.share({ files: [f], title: titulo });
          return;
        }
      } catch (e) {
        if (e && e.name === "AbortError") return;   // a pessoa fechou o menu
      }
    }
    const a = document.createElement("a");
    a.href = cartaz.url;
    a.download = cartaz.arquivo;
    document.body.appendChild(a); a.click(); a.remove();
    API.avisar("Cartaz salvo nos downloads do aparelho.");
  }

  function imprimirCartaz(){
    if (!cartaz) return;
    const moldura = document.createElement("iframe");
    moldura.style.cssText = "position:fixed;left:-9999px;top:0;width:600px;height:800px;border:0";
    document.body.appendChild(moldura);
    const d = moldura.contentDocument;
    d.open();
    d.write('<!doctype html><title>' + esc(cartaz.arquivo) + '</title>' +
            '<style>@page{margin:12mm}body{margin:0}img{width:100%}</style>' +
            '<img src="' + cartaz.url + '">');
    d.close();
    const imprimir = () => {
      try { moldura.contentWindow.focus(); moldura.contentWindow.print(); }
      catch (e) { API.avisar("Seu navegador não deixou imprimir. Salve a imagem e imprima por ela.", true); }
      setTimeout(() => moldura.remove(), 1500);
    };
    const img = d.querySelector("img");
    if (img && !img.complete) img.onload = imprimir;
    else setTimeout(imprimir, 120);
  }

  /* ---------------- partida ---------------- */
  // Os ouvintes entram por último: o primeiro aviso pode chegar na mesma hora,
  // e aí tudo o que ele mexe já precisa existir.
  refRest.onSnapshot(s => {
    const d = (s && s.data()) || {};
    conf.ate = d.pedidoAte || null;
    if (!LOJA) conf.ligado = !!d.pedidoNaMesa;   // restaurante de uma loja só
    if (!lojaP) ligadoP = !!d.pedidoNaMesa;
    ouvirComanda();
    pintarCliente();
    pintarPainel();
  }, () => {});

  // A loja do QR: a chave do pedido na mesa é dela.
  if (LOJA) refUnidadeC.onSnapshot(s => {
    const d = (s && s.exists && s.data()) || {};
    conf.ligado = !!d.pedidoNaMesa;
    ouvirComanda();
    pintarCliente();
  }, () => {});

  // A mesa do QR.
  if (MESA) refMesasC.doc(MESA).onSnapshot(s => {
    mesaDoc = s && s.exists ? Object.assign({ id: s.id }, s.data()) : null;
    ouvirComanda();
    pintarCliente();
  }, () => {});

  // Escolha da loja no painel do escritório.
  document.addEventListener("change", e => {
    if (e.target && e.target.id === "mesa-loja"){
      guardar("mesa-loja", e.target.value);
      trocarLoja(e.target.value);
    }
  });

  auth.onAuthStateChanged(u => { if (!u) desligarPainel(); });

  window.PEDIDOS = {
    aposCliente: pintarCliente,
    aposAdmin: aposAdmin
  };
})();
