/* Cardápio digital — Cardápio à Mesa
 *
 * O cardápio lê os dados do Firestore (leitura pública) e o dono edita pelo
 * painel depois de entrar com e-mail e senha do Firebase Auth. Quem decide se
 * uma conta pode salvar são as regras do Firestore (firestore.rules), conferidas
 * no servidor — o que esta página checa é só para mostrar a tela certa.
 *
 * Estrutura no banco:
 *   restaurantes/{slug}                 { site, secoes, atualizadoEm }      público
 *   restaurantes/{slug}/itens/{id}      { secao, nome, desc, preco, preco2,
 *                                         tag, foto, esgotado, ordem }      público
 *   restaurantes/{slug}/privado/acesso  { donos: [e-mails] }                só donos
 *
 * Cada seção tem um estilo:
 *   carta     nome, descrição e preço, como no cardápio impresso. Com
 *             `colunas` (ex.: ["Simples", "Especial"]) o item mostra dois
 *             preços: `preco` na primeira coluna e `preco2` na segunda.
 *   destaque  cartões com foto grande
 *   lista     linhas curtas com pontilhado (bebidas, adicionais)
 *   quadro    só texto, em caixas (`quadros: [{titulo, texto}]`), sem itens
 *   fotos     pratos com foto redonda (estilo do primeiro modelo)
 * `capa` é uma foto larga acima da seção (arquivo em img/), e `sobre` o
 * texto pequeno acima do título.
 */
(function(){
  "use strict";

  const CFG = window.CARDAPIO_CONFIG || {};
  const SLUG = CFG.restaurante;

  /* ---------------- utilidades ---------------- */
  const clonar = o => JSON.parse(JSON.stringify(o));
  // JSON com as chaves em ordem: o Firestore devolve os campos em outra ordem,
  // então comparar com JSON.stringify comum acusaria mudança onde não há.
  const estavel = o => JSON.stringify(o, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((a, c) => (a[c] = v[c], a), {})
      : v);
  const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  let original = null;   // a última versão lida do banco
  let dados = null;      // o que está na tela, com as edições ainda não publicadas
  let sujo = false;

  const itensDa = secaoId => dados.itens.filter(i => i.secao === secaoId);

  function avisar(texto, ruim){
    const t = document.getElementById("toast");
    t.textContent = texto;
    t.classList.toggle("ruim", !!ruim);
    t.hidden = false;
    clearTimeout(avisar.timer);
    avisar.timer = setTimeout(() => { t.hidden = true; }, ruim ? 6000 : 3500);
  }

  function estadoDaPagina(texto){
    document.getElementById("secoes").innerHTML = `<p class="carregando">${esc(texto)}</p>`;
  }

  /* ---------------- ícones ---------------- */
  const svg = corpo => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;
  // Ícone oficial do Instagram, colorido. Cada cópia ganha um id próprio para o
  // degradê: com id repetido, uma cópia escondida apagaria o degradê das outras.
  let nInsta = 0;
  const instagram = () => {
    const id = "ig-degrade-" + (++nInsta);
    return `<svg class="ig" viewBox="0 0 24 24" aria-hidden="true">
      <defs><radialGradient id="${id}" cx="0.28" cy="1.05" r="1.35">
        <stop offset="0" stop-color="#FFD600"/><stop offset=".22" stop-color="#FF9A00"/>
        <stop offset=".45" stop-color="#FF3D57"/><stop offset=".68" stop-color="#E4148E"/>
        <stop offset="1" stop-color="#7C2BF0"/></radialGradient></defs>
      <rect width="24" height="24" rx="6.6" fill="url(#${id})"/>
      <rect x="5.1" y="5.1" width="13.8" height="13.8" rx="4.1" fill="none" stroke="#fff" stroke-width="1.75"/>
      <circle cx="12" cy="12" r="3.25" fill="none" stroke="#fff" stroke-width="1.75"/>
      <circle cx="16.25" cy="7.75" r="1.05" fill="#fff"/></svg>`;
  };
  // Ícone do WhatsApp: balão com o telefone, em branco, para ir sobre o verde.
  const WHATSAPP = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.1a8.9 8.9 0 0 0-7.7 13.4L3.1 20.9l4.5-1.2A8.9 8.9 0 1 0 12 3.1z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M9.2 7.7c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .5.4l.8 1.9c.1.2.1.4 0 .6l-.5.7c-.1.2-.1.3 0 .5.5.9 1.3 1.7 2.2 2.2.2.1.3.1.5 0l.7-.6c.2-.1.4-.2.6-.1l1.9.9c.2.1.3.3.3.5 0 .6-.3 1.3-.9 1.6-.6.3-1.3.4-2 .2-1.4-.4-2.6-1.2-3.6-2.2s-1.8-2.2-2.2-3.6c-.2-.7-.1-1.4.2-2z" fill="#fff"/></svg>`;
  const ICONE = {
    mapa:    svg('<path d="M12 21s-6.5-6.1-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>'),
    relogio: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    telefone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
    // casa em enxaimel, o símbolo da marca: aparece onde o item não tem foto
    casa:    svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M5 14h14M9 10v10M15 10v10M9 14l6-4M9 10l6 4"/>')
  };

  // O campo aceita "@perfil", "perfil" ou o link inteiro do perfil. Para o cliente
  // aparece sempre "@perfil"; o botão abre o link que foi colado, ou o montado a
  // partir do @. Só aceita endereço do instagram.com, com http(s).
  function perfilInstagram(valor){
    const v = String(valor || "").trim();
    if (!v) return null;
    const m = v.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i);
    if (m) return { perfil: m[1], url: /^https?:\/\//i.test(v) ? v : "https://" + v };
    const h = v.replace(/^@/, "").replace(/\/+$/, "");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return null;
    return { perfil: h, url: "https://www.instagram.com/" + h + "/" };
  }

  // Instagram de quem fez o cardápio, embaixo da assinatura no rodapé.
  (function(){
    const a = document.getElementById("assinatura-insta");
    const ig = perfilInstagram(CFG.assinatura && CFG.assinatura.instagram);
    if (!a || !ig) return;
    a.href = ig.url;
    a.innerHTML = instagram() + "<span>@" + esc(ig.perfil) + "</span>";
    a.hidden = false;
  })();

  /* ---------------- cardápio do cliente ---------------- */
  const secaoDe = it => (dados && dados.secoes.find(s => s.id === it.secao)) || {};

  // Lojas da rede (vazio num restaurante de uma loja só). A loja do cliente
  // vem do QR (?loja=itaipava): o que esgotou nela aparece como esgotado.
  let lojas = [];
  const LOJA = (new URLSearchParams(location.search).get("loja") || "").trim();
  const lojaCliente = () => lojas.find(l => l.id === LOJA) || null;
  const fora = it => !!it.esgotado || !!(lojaCliente() && (lojaCliente().esgotados || []).indexOf(it.id) >= 0);
  // Duas colunas de preço só quando a seção tem os dois rótulos.
  const colunasDe = secao => (Array.isArray(secao.colunas) && secao.colunas.length === 2) ? secao.colunas : null;

  // "25,20" vira "R$ 25,20"; sem preço, "consulte" (melhor que um R$ sozinho).
  const preco = p => p ? `<small>R$</small>${esc(p)}` : `consulte`;

  function selo(it){
    if (fora(it)) return `<span class="selo-esgotado">Esgotado hoje</span>`;
    // etiqueta de chamada ("Famoso da casa", "Novidade") em vermelho; medida
    // e porção ("fatia", "500 ml") ficam discretas
    const forte = /famos|novidade|destaque|mais pedido|chef/i.test(it.tag || "");
    return it.tag ? `<span class="tag${forte ? " tag-forte" : ""}">${esc(it.tag)}</span>` : "";
  }

  function linhaCarta(it, colunas){
    const precos = colunas
      ? `<span class="precos"><span class="pr${it.preco ? "" : " consulte"}">${preco(it.preco)}</span><span class="pr${it.preco2 ? "" : " consulte"}">${it.preco2 ? preco(it.preco2) : "—"}</span></span>`
      : `<span class="precos um"><span class="pr${it.preco ? "" : " consulte"}">${preco(it.preco)}</span></span>`;
    return `<button class="prato${it.foto ? " tem-foto" : ""}${fora(it) ? " fora" : ""}" type="button" data-item="${esc(it.id)}">
      <span class="prato-corpo">
        <span class="prato-nome">${esc(it.nome)}</span>
        ${it.desc ? `<span class="prato-desc">${esc(it.desc)}</span>` : ""}
        ${selo(it)}
      </span>
      ${it.foto ? `<span class="mini-foto"><img src="${esc(it.foto)}" alt="${esc(it.nome)}" loading="lazy"></span>` : ""}
      ${precos}
    </button>`;
  }

  function linhaPrato(it){
    return `<button class="dish${fora(it) ? " fora" : ""}" type="button" data-item="${esc(it.id)}">
      ${it.foto ? `<span class="thumb"><img src="${esc(it.foto)}" alt="${esc(it.nome)}" loading="lazy"></span>` : ""}
      <span class="dish-body">
        <span class="dish-name">${esc(it.nome)}</span>
        <span class="dish-desc">${esc(it.desc)}</span>
        ${selo(it)}
      </span>
      <span class="price">${preco(it.preco)}</span>
    </button>`;
  }

  function cardDestaque(it){
    const foto = it.foto
      ? `<span class="card-foto"><img src="${esc(it.foto)}" alt="${esc(it.nome)}" loading="lazy"></span>`
      : `<span class="card-foto vazia" aria-hidden="true">${ICONE.casa}</span>`;
    return `<button class="special${fora(it) ? " fora" : ""}" type="button" data-item="${esc(it.id)}">
      ${foto}
      <span class="card-corpo">
        <span class="dish-name">${esc(it.nome)}</span>
        <span class="dish-desc">${esc(it.desc)}</span>
        ${selo(it)}
        <span class="price">${preco(it.preco)}</span>
      </span>
    </button>`;
  }

  // comFoto: algum item da seção tem foto. Quem não tem ganha o espaço vazio,
  // para os nomes continuarem alinhados.
  function linhaBebida(it, comFoto){
    const garrafa = it.foto
      ? `<span class="garrafa"><img src="${esc(it.foto)}" alt="${esc(it.nome)}" loading="lazy"></span>`
      : (comFoto ? `<span class="garrafa vazia" aria-hidden="true"></span>` : "");
    return `<div class="drink${fora(it) ? " fora" : ""}" data-item="${esc(it.id)}">
      ${garrafa}
      <span class="drink-name">${esc(it.nome)}${it.tag ? ` <small class="drink-tag">${esc(it.tag)}</small>` : ""}</span>
      ${fora(it) ? `<span class="selo-esgotado selo-bebida">Esgotado hoje</span>` : ""}
      <span class="dots"></span>
      <span class="drink-price">${preco(it.preco)}</span>
    </div>`;
  }

  function corpoDaSecao(s){
    const itens = itensDa(s.id);
    if (s.estilo === "quadro"){
      const qs = (s.quadros || []).filter(q => q.titulo || q.texto);
      return qs.length ? `<div class="quadros">${qs.map(q => `<div class="quadro">
          ${q.titulo ? `<h3>${esc(q.titulo)}</h3>` : ""}<p>${esc(q.texto)}</p></div>`).join("")}</div>` : "";
    }
    if (s.estilo === "lista"){
      const comFoto = itens.some(i => i.foto);
      return `<div class="drinks">${itens.map(i => linhaBebida(i, comFoto)).join("")}</div>`;
    }
    if (s.estilo === "destaque") return `<div class="specials">${itens.map(cardDestaque).join("")}</div>`;
    if (s.estilo === "fotos")    return `<div class="dishes">${itens.map(linhaPrato).join("")}</div>`;
    const colunas = colunasDe(s);
    const cab = colunas ? `<div class="carta-cab" aria-hidden="true"><span>${esc(colunas[0])}</span><span>${esc(colunas[1])}</span></div>` : "";
    return `<div class="carta${colunas ? " com-colunas" : ""}">${cab}${itens.map(i => linhaCarta(i, colunas)).join("")}</div>`;
  }

  function renderCliente(){
    if (!dados) return;
    const z = dados.site;
    document.getElementById("marca-nome").textContent = z.nome || "";
    document.getElementById("hero-nome").textContent = z.nome || "";
    document.getElementById("foot-nome").textContent = z.nome || "";
    document.getElementById("hero-chamada").textContent = z.chamada || "";
    if (z.nome) document.title = z.nome + " · Cardápio";

    const historia = document.getElementById("historia");
    if (historia){
      historia.hidden = !z.historia;
      document.getElementById("historia-texto").textContent = z.historia || "";
    }

    document.getElementById("tabs").innerHTML = dados.secoes
      .map(s => `<a href="#${esc(s.id)}">${esc(s.aba || s.nome)}</a>`).join("");

    document.getElementById("secoes").innerHTML = dados.secoes.map(s => {
      const sobre = s.sobre || s.kanji || "";
      return `<section id="${esc(s.id)}">
        <div class="sec-head">
          ${sobre ? `<p class="eyebrow">${esc(sobre)}</p>` : ""}
          <h2>${esc(s.nome)}</h2>
          ${s.nota ? `<p class="sec-note">${esc(s.nota)}</p>` : ""}
        </div>
        ${s.capa ? `<img class="capa" src="${esc(s.capa)}" alt="" loading="lazy">` : ""}
        ${corpoDaSecao(s)}
      </section>`;
    }).join("");

    const ig = perfilInstagram(z.instagram);
    const bts = [];
    if (dados.secoes[0]) bts.push(`<a class="cta cta-a" href="#${esc(dados.secoes[0].id)}">Ver o cardápio</a>`);
    if (z.whatsapp) bts.push(`<a class="cta cta-b" href="https://wa.me/${esc(z.whatsapp)}" target="_blank" rel="noopener">Pedir no WhatsApp</a>`);
    document.getElementById("hero-botoes").innerHTML = bts.join("");

    // WhatsApp e Instagram são ações de tocar e ir: ficam juntos, como botões.
    // Endereço e horário são informação: ficam nos cartões.
    let acoes = "";
    if (z.whatsapp) acoes += `<a class="cta-whats" href="https://wa.me/${esc(z.whatsapp)}" target="_blank" rel="noopener" aria-label="Pedir pelo WhatsApp" title="Pedir pelo WhatsApp">${WHATSAPP}</a>`;
    if (ig) acoes += `<a class="cta cta-insta" href="${esc(ig.url)}" target="_blank" rel="noopener" aria-label="Instagram: @${esc(ig.perfil)}">${instagram()}<span>@${esc(ig.perfil)}</span></a>`;
    let contato = acoes ? `<div class="acoes">${acoes}</div>` : "";
    const cartoes = [];
    if (z.endereco) cartoes.push(`<a class="info" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(z.endereco)}" target="_blank" rel="noopener">
        <span class="info-icone">${ICONE.mapa}</span>
        <span class="info-rotulo">Endereço</span>
        <span class="info-valor">${esc(z.endereco)}</span>
        <span class="info-acao">Abrir no Google Maps</span></a>`);
    if (z.horario) cartoes.push(`<div class="info">
        <span class="info-icone">${ICONE.relogio}</span>
        <span class="info-rotulo">Horário</span>
        <span class="info-valor">${esc(z.horario)}</span></div>`);
    if (cartoes.length) contato += `<div class="infos infos-${cartoes.length}">${cartoes.join("")}</div>`;
    document.getElementById("contato").innerHTML = contato;
    renderLojas();

    ligarScrollspy();
    if (window.PEDIDOS) window.PEDIDOS.aposCliente();
  }

  // "Nossas lojas" no fim da página, e o nome da loja no topo quando o
  // cliente chegou pelo QR de uma delas.
  function renderLojas(){
    const caixa = document.getElementById("lojas");
    const aqui = document.getElementById("loja-atual");
    const atual = lojaCliente();
    if (aqui){
      aqui.hidden = !atual;
      aqui.innerHTML = atual ? `${ICONE.mapa}<span>Você está na loja <strong>${esc(atual.nome)}</strong></span>` : "";
    }
    if (!caixa) return;
    caixa.hidden = !lojas.length;
    if (!lojas.length){ caixa.innerHTML = ""; return; }
    // a loja do cliente vem primeiro
    const ordem = atual ? [atual].concat(lojas.filter(l => l !== atual)) : lojas;
    caixa.innerHTML = `<h2 class="lojas-titulo">Nossas lojas</h2>
      <div class="lojas-lista">${ordem.map(l => {
        const tel = String(l.telefone || "").replace(/\D/g, "");
        return `<div class="loja${l === atual ? " aqui" : ""}">
          <h3>${esc(l.nome)}${l === atual ? ` <span class="loja-selo">você está aqui</span>` : ""}</h3>
          ${l.endereco ? `<p>${esc(l.endereco)}</p>` : ""}
          <div class="loja-acoes">
            ${l.endereco ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(((dados && dados.site.nome) || "") + " " + l.endereco)}" target="_blank" rel="noopener">${ICONE.mapa}Mapa</a>` : ""}
            ${tel ? `<a href="tel:+55${esc(tel)}">${ICONE.telefone}${esc(l.telefone)}</a>` : ""}
            ${/^https:\/\/(www\.)?ifood\.com\.br\//.test(l.ifood || "") ? `<a href="${esc(l.ifood)}" target="_blank" rel="noopener" class="loja-ifood">iFood</a>` : ""}
          </div>
        </div>`;
      }).join("")}</div>`;
  }

  /* ---------------- ampliar foto ---------------- */
  const lb = document.getElementById("lb");
  let voltarPara = null;

  function abrirFoto(id){
    const it = dados && dados.itens.find(x => x.id === id);
    if (!it || !it.foto) return;
    document.getElementById("lb-img").src = it.foto;
    document.getElementById("lb-img").alt = it.nome;
    document.getElementById("lb-name").textContent = it.nome + (fora(it) ? " — esgotado hoje" : "");
    document.getElementById("lb-desc").textContent = it.desc || "";
    const colunas = colunasDe(secaoDe(it));
    document.getElementById("lb-price").textContent = colunas && it.preco2
      ? `${colunas[0]}: R$ ${it.preco} · ${colunas[1]}: R$ ${it.preco2}`
      : (it.preco ? "R$ " + it.preco : "");
    lb.hidden = false;
    document.getElementById("lb-close").focus();
  }
  function fecharFoto(){
    lb.hidden = true;
    if (voltarPara){ voltarPara.focus(); voltarPara = null; }
  }
  document.addEventListener("click", e => {
    const card = e.target.closest("[data-item]");
    if (card && !card.closest(".admin")){ voltarPara = card; abrirFoto(card.dataset.item); return; }
    if (e.target === lb || e.target.id === "lb-close") fecharFoto();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !lb.hidden) fecharFoto(); });

  /* ---------------- scrollspy ---------------- */
  let io = null;
  function ligarScrollspy(){
    if (!("IntersectionObserver" in window)) return;
    if (io) io.disconnect();
    const tabs = [...document.querySelectorAll(".tabs a")];
    io = new IntersectionObserver(entradas => {
      const visivel = entradas.filter(x => x.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visivel) return;
      tabs.forEach(t => t.setAttribute("aria-current", String(t.hash === "#" + visivel.target.id)));
      // com muitas seções a aba ativa sai da tela: a fileira de abas acompanha
      const ativa = tabs.find(t => t.hash === "#" + visivel.target.id);
      const fileira = document.getElementById("tabs");
      if (ativa && fileira.scrollWidth > fileira.clientWidth)
        fileira.scrollTo({ left: ativa.offsetLeft - (fileira.clientWidth - ativa.offsetWidth) / 2, behavior: "smooth" });
    }, { rootMargin: "-88px 0px -62% 0px" });
    document.querySelectorAll("#secoes section").forEach(s => io.observe(s));
  }

  /* ---------------- Firebase ---------------- */
  const configurado = !!(CFG.firebase && CFG.firebase.apiKey && !/COLE/.test(CFG.firebase.apiKey) && SLUG);
  if (!configurado || typeof window.firebase === "undefined"){
    estadoDaPagina("Cardápio em configuração. Volte em instantes.");
    document.getElementById("abrir-admin").hidden = true;
    return;
  }

  firebase.initializeApp(CFG.firebase);
  const db = firebase.firestore();
  const auth = firebase.auth();
  auth.languageCode = "pt";

  const refRest = db.collection("restaurantes").doc(SLUG);
  const refItens = refRest.collection("itens");
  const refAcesso = refRest.collection("privado").doc("acesso");

  // Ponte para o pedido na mesa (mesa.js). O módulo é opcional: sem ele, o
  // cardápio funciona exatamente como antes.
  window.CARDAPIO = {
    cfg: CFG, db, auth, refRest, esc, avisar, fora,
    dados: () => dados,
    lojas: () => lojas,
    papel: () => papel,
    ehDono: () => ehDono
  };

  // As lojas chegam do banco; enquanto não chegam, o painel espera (é preciso
  // saber as lojas para descobrir de qual delas um gerente é).
  let lojasProntas;
  const lojasPronto = new Promise(ok => { lojasProntas = ok; });
  refRest.collection("lojas").orderBy("ordem").onSnapshot(qs => {
    lojas = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
    lojasProntas();
    if (dados) renderCliente();
    // o painel do escritório mostra a lista de lojas: redesenha, menos no meio
    // de uma edição de item
    if (!painel.hidden && !conteudoAdmin.hidden && papel && papel.rede && !editando) renderAdmin();
  }, () => lojasProntas());

  const painel = document.getElementById("admin");
  const tranca = document.getElementById("tranca");
  const conteudoAdmin = document.getElementById("admin-conteudo");
  const corpoAdmin = document.getElementById("admin-corpo");
  const btPublicar = document.getElementById("publicar");
  const btDescartar = document.getElementById("descartar");
  const seloEdicao = document.getElementById("estado-edicao");

  // O Firebase leva um instante para lembrar quem já estava logado neste aparelho.
  const authPronto = new Promise(ok => {
    const parar = auth.onAuthStateChanged(() => { parar(); ok(); });
  });

  /* ---------------- leitura do cardápio ---------------- */
  let docRest, docsItens;   // undefined = ainda não chegou

  function falhaLeitura(err){
    console.error("Falha ao ler o cardápio:", err);
    if (!dados) estadoDaPagina("Não foi possível carregar o cardápio agora. Tente de novo em instantes.");
  }

  function juntar(){
    if (docRest === undefined || docsItens === undefined) return;
    if (docRest === null){ estadoDaPagina("Cardápio em preparação. Volte em instantes."); return; }
    const remoto = {
      site: docRest.site || {},
      secoes: docRest.secoes || [],
      itens: docsItens
    };
    original = remoto;
    // o dono no meio de uma edição não perde o que digitou quando o banco muda
    if (!sujo) dados = clonar(remoto);
    renderCliente();
    if (!painel.hidden && !conteudoAdmin.hidden){
      if (!sujo) renderAdmin(); else marcarSujo();
    }
  }

  refRest.onSnapshot(snap => { docRest = snap.exists ? snap.data() : null; juntar(); }, falhaLeitura);
  refItens.orderBy("ordem").onSnapshot(qs => {
    docsItens = qs.docs.map(d => {
      const x = d.data();
      return { id: d.id, secao: x.secao || "", nome: x.nome || "", desc: x.desc || "",
               preco: x.preco || "", preco2: x.preco2 || "", tag: x.tag || "", foto: x.foto || "",
               esgotado: !!x.esgotado };
    });
    juntar();
  }, falhaLeitura);

  /* ---------------- painel do dono ---------------- */

  let ehDono = false;      // pode abrir o painel (dono da rede ou gerente de loja)
  let papel = null;        // { rede: true } escritório/dono  ·  { loja: "id" } gerente de uma loja
  let publicando = false;
  let editando = null;     // id do item aberto no formulário, ou "novo"
  let fotoPendente = null;
  let rascunho = null;     // campos digitados no formulário ainda não salvos

  function marcarSujo(){
    sujo = !!(dados && original) && estavel(dados) !== estavel(original);
    seloEdicao.hidden = !sujo;
    btDescartar.hidden = !sujo;
    btPublicar.disabled = !(sujo && ehDono && papel && papel.rede) || publicando;
  }

  // Quem é esta conta: só consegue ler um privado/acesso quem as regras
  // deixam mexer. O do restaurante é do dono (escritório); o de cada loja é
  // dos gerentes dela.
  async function conferirPapel(){
    papel = null;
    try { await refAcesso.get(); papel = { rede: true }; }
    catch (e) {
      await lojasPronto;
      for (const l of lojas){
        try {
          await refRest.collection("lojas").doc(l.id).collection("privado").doc("acesso").get();
          papel = { loja: l.id };
          break;
        } catch (e2) { /* não é desta loja */ }
      }
    }
    ehDono = !!papel;
    return ehDono;
  }

  async function abrirAdmin(){
    painel.hidden = false;
    document.body.style.overflow = "hidden";
    await authPronto;
    if (auth.currentUser){
      if (await conferirPapel()){ liberar(); return; }
      mostrarTranca("Esta conta não administra este cardápio. Entre com outra.");
      return;
    }
    mostrarTranca();
  }

  function fecharAdmin(){
    painel.hidden = true;
    document.body.style.overflow = "";
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
  }

  function liberar(){
    document.getElementById("tranca-erro").hidden = true;
    tranca.hidden = true;
    conteudoAdmin.hidden = false;
    renderAdmin();
  }

  function mostrarTranca(msg){
    tranca.hidden = false;
    conteudoAdmin.hidden = true;
    const erro = document.getElementById("tranca-erro");
    erro.hidden = !msg;
    erro.textContent = msg || "";
    document.getElementById("tr-senha").value = "";
    document.getElementById("tr-email").focus();
  }

  function mensagemDeLogin(err){
    const c = err && err.code;
    if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-email")
      return "E-mail ou senha não conferem.";
    if (c === "auth/too-many-requests") return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
    if (c === "auth/network-request-failed") return "Sem conexão com a internet.";
    if (c === "auth/unauthorized-domain") return "Este endereço ainda não foi autorizado no Firebase.";
    if (c === "auth/user-disabled") return "Esta conta foi desativada.";
    return "Não foi possível entrar agora. Tente de novo.";
  }

  async function entrar(){
    const email = document.getElementById("tr-email").value.trim();
    const senha = document.getElementById("tr-senha").value;
    const erro = document.getElementById("tranca-erro");
    const bt = document.getElementById("tr-entrar");
    if (!email || !senha){ erro.hidden = false; erro.textContent = "Preencha e-mail e senha."; return; }
    bt.disabled = true; bt.textContent = "Entrando…";
    try {
      await auth.signInWithEmailAndPassword(email, senha);
      if (!(await conferirPapel())){
        await auth.signOut();
        mostrarTranca("Esta conta não administra este cardápio.");
        return;
      }
      liberar();
    } catch (err) {
      erro.hidden = false;
      erro.textContent = mensagemDeLogin(err);
    } finally {
      bt.disabled = false; bt.textContent = "Entrar";
    }
  }

  async function esqueci(){
    const email = document.getElementById("tr-email").value.trim();
    const erro = document.getElementById("tranca-erro");
    erro.hidden = false;
    if (!email){ erro.textContent = "Digite o seu e-mail acima e clique de novo em \"Esqueci a senha\"."; return; }
    try { await auth.sendPasswordResetEmail(email); }
    catch (err) { if (err && err.code === "auth/network-request-failed"){ erro.textContent = "Sem conexão com a internet."; return; } }
    // não conta se o e-mail existe ou não
    erro.textContent = "Se esse e-mail tiver acesso, chega nele um link para criar uma senha nova.";
  }

  document.getElementById("tr-entrar").addEventListener("click", entrar);
  document.getElementById("tr-senha").addEventListener("keydown", e => { if (e.key === "Enter") entrar(); });
  document.getElementById("tr-esqueci").addEventListener("click", esqueci);
  document.getElementById("tr-voltar").addEventListener("click", fecharAdmin);
  document.getElementById("abrir-admin").addEventListener("click", abrirAdmin);
  document.getElementById("fechar-admin").addEventListener("click", () => { renderCliente(); fecharAdmin(); });
  document.getElementById("sair").addEventListener("click", async () => {
    if (sujo && !window.confirm("Há alterações não publicadas. Sair mesmo assim?")) return;
    await auth.signOut();
    ehDono = false; papel = null;
    if (original){ dados = clonar(original); marcarSujo(); renderCliente(); }
    fecharAdmin();
    avisar("Você saiu da área do dono.");
  });

  auth.onAuthStateChanged(u => { if (!u){ ehDono = false; papel = null; } });

  /* -------- formulário e listas do painel -------- */
  function campo(rotulo, chave, valor, opc){
    opc = opc || {};
    const ajuda = opc.ajuda ? `<span class="ajuda">${esc(opc.ajuda)}</span>` : "";
    const ctrl = opc.area
      ? `<textarea data-campo="${chave}">${esc(valor)}</textarea>`
      : `<input type="text" data-campo="${chave}" value="${esc(valor)}" ${opc.placeholder ? `placeholder="${esc(opc.placeholder)}"` : ""}>`;
    return `<div class="campo${opc.largo ? " largo" : ""}"><label>${esc(rotulo)}</label>${ctrl}${ajuda}</div>`;
  }

  function formularioItem(it){
    const novo = !it.id;
    const colunas = colunasDe(secaoDe(it));
    const fotoVista = fotoPendente !== null ? fotoPendente : it.foto;
    const opcoes = dados.secoes.filter(s => s.estilo !== "quadro").map(s =>
      `<option value="${esc(s.id)}" ${s.id === it.secao ? "selected" : ""}>${esc(s.nome)}</option>`).join("");
    return `<div class="bloco" id="form-item">
      <h3>${novo ? "Novo item" : "Editando: " + esc(it.nome)}</h3>
      <p class="dica">O que você salvar aqui só vai para o cliente depois de clicar em <strong>Publicar</strong>.</p>
      <div class="campos">
        ${campo("Nome do prato", "nome", it.nome || "")}
        <div class="campo"><label>Seção</label><select data-campo="secao">${opcoes}</select></div>
        ${campo("Descrição", "desc", it.desc || "", {largo:true, area:true})}
        ${campo(colunas ? "Preço · " + colunas[0] : "Preço", "preco", it.preco || "", {ajuda:"Só o número, com vírgula. Ex.: 25,20"})}
        ${colunas ? campo("Preço · " + colunas[1], "preco2", it.preco2 || "", {ajuda:"Deixe vazio se não houver esta opção."}) : ""}
        ${campo("Etiqueta (opcional)", "tag", it.tag || "", {ajuda:"Ex.: fatia, 500 ml, Famoso da casa"})}
        <div class="campo largo">
          <label>Disponibilidade</label>
          <label style="display:flex;gap:9px;align-items:center;text-transform:none;letter-spacing:0;font-size:15px;font-weight:400;color:var(--rice)">
            <input type="checkbox" data-campo="esgotado" ${it.esgotado ? "checked" : ""} style="width:auto">
            Marcar como <strong style="color:var(--beni-lt)">esgotado hoje</strong>
          </label>
          <span class="ajuda">O prato continua no cardápio, com selo de esgotado e preço riscado.</span>
        </div>
        <div class="campo largo">
          <label>Foto</label>
          <div class="foto-edit">
            ${fotoVista ? `<img class="mini" id="previa" src="${esc(fotoVista)}" alt="">`
                        : `<span class="mini vazia" id="previa">${ICONE.casa}</span>`}
            <input type="file" id="arquivo-foto" accept="image/*">
            <button class="bt" type="button" id="escolher-foto">Escolher foto</button>
            ${fotoVista ? `<button class="bt perigo" type="button" id="tirar-foto">Remover foto</button>` : ""}
            <span class="ajuda" id="peso-foto">A foto é reduzida automaticamente.</span>
          </div>
        </div>
      </div>
      <div class="linha-acoes" style="margin-top:18px;justify-content:flex-start">
        <button class="bt forte" type="button" id="salvar-item">${novo ? "Adicionar ao cardápio" : "Salvar alterações"}</button>
        <button class="bt" type="button" id="cancelar-item">Cancelar</button>
      </div>
    </div>`;
  }

  function blocoConta(){
    const usuario = auth.currentUser;
    return `<div class="bloco">
      <h3>Sua conta</h3>
      <p class="dica">Você entrou como <strong>${esc(usuario ? usuario.email : "")}</strong>.</p>
      <div class="campos">
        <div class="campo"><label>Nova senha</label><input type="password" id="nova-senha-1" autocomplete="new-password"></div>
        <div class="campo"><label>Repita a nova senha</label><input type="password" id="nova-senha-2" autocomplete="new-password"></div>
      </div>
      <div class="linha-acoes" style="justify-content:flex-start;margin-top:14px">
        <button class="bt" type="button" data-acao="trocar-senha">Trocar senha</button>
      </div>
      <p class="dica" id="aviso-senha" style="margin:12px 0 0"></p>
    </div>`;

  }

  // Lojas da rede: o escritório cadastra, edita e define os gerentes de cada
  // uma. Grava na hora (não passa pelo botão Publicar).
  function blocoLojas(){
    const linhas = lojas.map((l, i) => `<div class="linha-item">
        <span class="linha-corpo">
          <span class="linha-nome">${esc(l.nome || l.id)}</span>
          <span class="linha-sub">${esc([l.endereco, l.telefone].filter(Boolean).join(" · ") || "sem endereço")}${l.ifood ? " · iFood" : ""}${l.pedidoNaMesa ? " · pedido na mesa ligado" : ""}</span>
        </span>
        <span class="linha-acoes">
          <button class="bt mini-bt" type="button" data-acao="loja-subir" data-id="${esc(l.id)}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="bt mini-bt" type="button" data-acao="loja-descer" data-id="${esc(l.id)}" ${i === lojas.length - 1 ? "disabled" : ""}>↓</button>
          <button class="bt mini-bt" type="button" data-acao="loja-editar" data-id="${esc(l.id)}">Editar</button>
          <button class="bt mini-bt" type="button" data-acao="loja-gerentes" data-id="${esc(l.id)}">Gerentes</button>
          <button class="bt mini-bt perigo" type="button" data-acao="loja-excluir" data-id="${esc(l.id)}">Excluir</button>
        </span>
      </div>`).join("");
    return `<div class="bloco">
      <h3>Lojas</h3>
      <p class="dica">${lojas.length
        ? "Cada loja tem as suas mesas, os seus pedidos, o que esgotou e o seu caixa. Os gerentes entram com o próprio e-mail e só veem a loja deles. As mudanças aqui valem na hora."
        : "Restaurante com uma loja só. Se abrir outras, cadastre cada uma aqui: cada loja passa a ter as suas mesas, pedidos e caixa."}</p>
      ${linhas}
      <div class="linha-acoes" style="justify-content:flex-start;margin-top:14px">
        <button class="bt" type="button" data-acao="loja-nova">+ Nova loja</button>
      </div>
    </div>`;
  }

  async function acaoLoja(acao, id){
    const ref = x => refRest.collection("lojas").doc(x);
    const l = lojas.find(x => x.id === id);
    try {
      if (acao === "loja-nova" || acao === "loja-editar"){
        const nome = window.prompt("Nome da loja (aparece para o cliente):", l ? l.nome || "" : "");
        if (nome === null || !nome.trim()) return;
        const endereco = window.prompt("Endereço:", l ? l.endereco || "" : "");
        if (endereco === null) return;
        const telefone = window.prompt("Telefone (com DDD):", l ? l.telefone || "" : "");
        if (telefone === null) return;
        const ifood = window.prompt("Link do iFood desta loja (pode deixar vazio):", l ? l.ifood || "" : "");
        if (ifood === null) return;
        const campos = { nome: nome.trim(), endereco: endereco.trim(), telefone: telefone.trim(), ifood: ifood.trim() };
        if (l){ await ref(l.id).update(campos); avisar("Loja atualizada."); return; }
        const novoId = nome.trim().toLowerCase().normalize("NFD").replace(ACENTOS, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || ("loja" + Date.now().toString(36));
        if (lojas.some(x => x.id === novoId)){ avisar("Já existe uma loja com esse nome.", true); return; }
        await ref(novoId).set(Object.assign(campos, { ordem: lojas.length, pedidoNaMesa: false, esgotados: [] }));
        avisar("Loja criada. Agora cadastre os gerentes e as mesas dela.");
        return;
      }
      if (!l) return;
      if (acao === "loja-gerentes"){
        let atuais = [];
        try { const s = await ref(l.id).collection("privado").doc("acesso").get(); atuais = (s.exists && s.data().gerentes) || []; }
        catch (e) { /* ainda não tem lista */ }
        const r = window.prompt(`E-mails dos gerentes da loja ${l.nome}, separados por vírgula.\nCada um precisa de um login criado no Firebase (Authentication).`, atuais.join(", "));
        if (r === null) return;
        const gerentes = [...new Set(r.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes("@")))];
        await ref(l.id).collection("privado").doc("acesso").set({ gerentes });
        avisar(gerentes.length ? `Gerentes da loja ${l.nome}: ${gerentes.join(", ")}` : `A loja ${l.nome} ficou sem gerente.`);
        return;
      }
      if (acao === "loja-subir" || acao === "loja-descer"){
        const i = lojas.indexOf(l), j = i + (acao === "loja-subir" ? -1 : 1);
        if (j < 0 || j >= lojas.length) return;
        const lote = db.batch();
        lote.update(ref(l.id), { ordem: j });
        lote.update(ref(lojas[j].id), { ordem: i });
        await lote.commit();
        return;
      }
      if (acao === "loja-excluir"){
        if (!window.confirm(`Excluir a loja ${l.nome}? Os QR Codes das mesas dela param de funcionar.`)) return;
        await ref(l.id).delete();
        avisar("Loja excluída.");
      }
    } catch (err) {
      console.error("Lojas:", err);
      avisar(err && err.code === "permission-denied" ? "Esta conta não pode mexer nas lojas." : "Não deu para salvar agora. Tente de novo.", true);
    }
  }

  function renderAdmin(){
    if (!dados){ corpoAdmin.innerHTML = `<p class="carregando">Carregando o cardápio…</p>`; return; }
    const z = dados.site;
    let html = "";

    // Gerente de loja: só o painel da loja dele (pedidos, mesas, esgotados,
    // caixa) e a conta. O cardápio é do escritório.
    if (!papel || !papel.rede){
      btPublicar.hidden = true; btDescartar.hidden = true; seloEdicao.hidden = true;
      corpoAdmin.innerHTML = blocoConta();
      if (window.PEDIDOS) window.PEDIDOS.aposAdmin(corpoAdmin);
      return;
    }
    btPublicar.hidden = false;

    if (editando){
      const base = editando === "novo"
        ? { secao: (dados.secoes.find(s => s.estilo !== "quadro") || {}).id || "", nome:"", desc:"", preco:"", preco2:"", tag:"", foto:"", esgotado:false }
        : dados.itens.find(x => x.id === editando);
      // rascunho: o que já foi digitado, quando o formulário é redesenhado
      // (trocar a seção pode mostrar ou esconder o segundo preço)
      if (base) html += formularioItem(Object.assign({}, base, rascunho || {}, { id: base.id }));
    }

    // ----- itens -----
    html += `<div class="bloco">
      <h3>Itens do cardápio</h3>
      <p class="dica">${dados.itens.length} itens. Use <strong>Esgotou</strong> para tirar do ar sem apagar o prato.</p>
      <div class="linha-acoes" style="justify-content:flex-start;margin-bottom:12px">
        <button class="bt forte" type="button" data-acao="novo">+ Novo item</button>
      </div>`;
    dados.secoes.forEach(s => {
      if (s.estilo === "quadro") return;
      const itens = itensDa(s.id);
      const colunas = colunasDe(s);
      html += `<div class="grupo-secao"><h4>${esc(s.nome)} · ${itens.length}</h4>`;
      if (!itens.length) html += `<p class="dica">Nenhum item nesta seção ainda.</p>`;
      itens.forEach((it, idx) => {
        const valor = colunas && it.preco2
          ? `${esc(colunas[0])} R$ ${esc(it.preco)} · ${esc(colunas[1])} R$ ${esc(it.preco2)}`
          : (it.preco ? "R$ " + esc(it.preco) : `<span style="color:var(--beni-lt)">sem preço</span>`);
        html += `<div class="linha-item">
          ${it.foto ? `<img class="mini" src="${esc(it.foto)}" alt="">` : `<span class="mini vazia">${ICONE.casa}</span>`}
          <span class="linha-corpo">
            <span class="linha-nome">${esc(it.nome)}${it.esgotado ? ' <span style="color:var(--beni-lt);font-size:12px">· esgotado</span>' : ""}</span>
            <span class="linha-sub">${valor}${it.tag ? " · " + esc(it.tag) : ""}</span>
          </span>
          <span class="linha-acoes">
            <button class="bt mini-bt" type="button" data-acao="subir" data-id="${esc(it.id)}" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button class="bt mini-bt" type="button" data-acao="descer" data-id="${esc(it.id)}" ${idx === itens.length-1 ? "disabled" : ""}>↓</button>
            <button class="bt mini-bt" type="button" data-acao="esgotar" data-id="${esc(it.id)}">${it.esgotado ? "Voltou" : (lojas.length ? "Esgotou em todas" : "Esgotou")}</button>
            <button class="bt mini-bt" type="button" data-acao="editar" data-id="${esc(it.id)}">Editar</button>
            <button class="bt mini-bt perigo" type="button" data-acao="excluir" data-id="${esc(it.id)}">Excluir</button>
          </span>
        </div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;

    // ----- seções -----
    html += `<div class="bloco">
      <h3>Seções</h3>
      <p class="dica">O título e a frase que aparecem acima de cada grupo de pratos.</p>`;
    dados.secoes.forEach((s, idx) => {
      html += `<div class="linha-item">
        <span class="linha-corpo">
          <span class="linha-nome">${esc(s.nome)}</span>
          <span class="linha-sub">${esc(s.nota || "sem frase")}</span>
        </span>
        <span class="linha-acoes">
          <button class="bt mini-bt" type="button" data-acao="secao-subir" data-id="${esc(s.id)}" ${idx === 0 ? "disabled" : ""}>↑</button>
          <button class="bt mini-bt" type="button" data-acao="secao-descer" data-id="${esc(s.id)}" ${idx === dados.secoes.length-1 ? "disabled" : ""}>↓</button>
          <button class="bt mini-bt" type="button" data-acao="secao-editar" data-id="${esc(s.id)}">Editar</button>
        </span>
      </div>`;
    });
    html += `<div class="linha-acoes" style="justify-content:flex-start;margin-top:14px">
        <button class="bt" type="button" data-acao="secao-nova">+ Nova seção</button>
      </div></div>`;

    html += blocoLojas();

    // ----- dados da casa -----
    html += `<div class="bloco">
      <h3>Dados da casa</h3>
      <p class="dica">O WhatsApp acende o botão de pedido no topo e no rodapé.</p>
      <div class="campos">
        ${campo("Nome", "site.nome", z.nome)}
        ${campo("WhatsApp", "site.whatsapp", z.whatsapp, {ajuda:"Só números, com 55 e DDD. Ex.: 5521999998888", placeholder:"5521999998888"})}
        ${campo("Frase de abertura", "site.chamada", z.chamada, {largo:true, area:true})}
        ${campo("Instagram", "site.instagram", z.instagram, {placeholder:"@casadoalemaooficial", ajuda:"Pode colar o link do perfil ou escrever só o @."})}
        ${campo("Horário", "site.horario", z.horario, {largo:true, area:true, ajuda:"Pode usar várias linhas. Ex.: Qua a dom · jantar a partir das 18h (Enter) Sáb e dom · almoço das 11h às 15h"})}
        ${campo("Endereço", "site.endereco", z.endereco, {largo:true})}
        ${campo("Nossa história", "site.historia", z.historia || "", {largo:true, area:true, ajuda:"Aparece no fim do cardápio, ao lado da foto antiga da loja. Vazio, o bloco some."})}
      </div>
    </div>`;

    html += blocoConta();

    // ----- link e QR -----
    html += `<div class="bloco">
      <h3>Link e QR Code</h3>
      <p class="dica">Este é o endereço que vai na bio e no QR da mesa.</p>
      <div class="qr-area">
        <div class="qr-caixa" id="qr"></div>
        <div class="qr-lado">
          <p class="link-publico" id="link-publico">${esc(z.url || "")}</p>
          <div class="linha-acoes" style="justify-content:flex-start">
            <button class="bt" type="button" data-acao="copiar-link">Copiar link</button>
          </div>
          <p class="dica" style="margin-top:12px">Para imprimir, peça o cartaz em alta resolução.</p>
        </div>
      </div>
    </div>`;

    corpoAdmin.innerHTML = html;
    desenharQR();
    marcarSujo();
    if (window.PEDIDOS) window.PEDIDOS.aposAdmin(corpoAdmin);
  }

  function desenharQR(){
    const alvo = document.getElementById("qr");
    if (!alvo) return;
    alvo.innerHTML = "";
    const url = (dados.site.url || "").trim();
    const nota = t => `<span style="color:#120E0C;font-size:12px;font-family:sans-serif">${t}</span>`;
    if (!url){ alvo.innerHTML = nota("sem endereço"); return; }
    if (typeof window.QRCode === "undefined"){ alvo.innerHTML = nota("QR indisponível<br>sem internet"); return; }
    try { new window.QRCode(alvo, { text: url, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M }); }
    catch (e) { alvo.innerHTML = nota("não deu para gerar o QR"); }
  }

  /* -------- foto -------- */
  // Recorte deitado 4:3 de 600 x 450 px em JPEG, pelo centro da foto: serve
  // para o cartão de destaque, a miniatura da carta e a foto ampliada. Cabe
  // folgado no limite de 1 MB do documento.
  function processarFoto(file){
    return new Promise((ok, falhou) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          const W = 600, H = 450;
          const iw = img.naturalWidth, ih = img.naturalHeight;
          const lw = Math.min(iw, ih * W / H), lh = lw * H / W;
          c.width = W; c.height = H;
          c.getContext("2d").drawImage(img, (iw - lw)/2, (ih - lh)/2, lw, lh, 0, 0, W, H);
          ok(c.toDataURL("image/jpeg", 0.78));
        } catch (e) { falhou(e); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); falhou(new Error("arquivo não é uma imagem")); };
      img.src = url;
    });
  }

  /* -------- ações do painel -------- */
  corpoAdmin.addEventListener("click", async e => {
    const bt = e.target.closest("button");
    if (!bt) return;
    const acao = bt.dataset.acao;
    const id = bt.dataset.id;

    if (bt.id === "escolher-foto"){ document.getElementById("arquivo-foto").click(); return; }
    if (bt.id === "tirar-foto"){
      fotoPendente = "";
      const p = document.getElementById("previa");
      if (p) p.replaceWith(Object.assign(document.createElement("span"), {className:"mini vazia", id:"previa", innerHTML:ICONE.casa}));
      bt.remove();
      return;
    }
    if (bt.id === "salvar-item"){ salvarItem(); return; }
    if (bt.id === "cancelar-item"){ editando = null; fotoPendente = null; rascunho = null; renderAdmin(); return; }

    if (acao === "novo"){ editando = "novo"; fotoPendente = null; rascunho = null; renderAdmin(); rolarAoForm(); return; }
    if (acao === "editar"){ editando = id; fotoPendente = null; rascunho = null; renderAdmin(); rolarAoForm(); return; }
    if (acao === "esgotar"){
      const it = dados.itens.find(x => x.id === id);
      if (it) it.esgotado = !it.esgotado;
      renderAdmin(); return;
    }
    if (acao === "excluir"){
      const it = dados.itens.find(x => x.id === id);
      if (it && window.confirm(`Excluir "${it.nome}" do cardápio?`)){
        dados.itens = dados.itens.filter(x => x.id !== id);
        if (editando === id) editando = null;
        renderAdmin();
      }
      return;
    }
    if (acao === "subir" || acao === "descer"){ mover(id, acao === "subir" ? -1 : 1); return; }
    if (acao === "secao-subir" || acao === "secao-descer"){
      const i = dados.secoes.findIndex(s => s.id === id);
      const j = i + (acao === "secao-subir" ? -1 : 1);
      if (i >= 0 && j >= 0 && j < dados.secoes.length){
        const t = dados.secoes[i]; dados.secoes[i] = dados.secoes[j]; dados.secoes[j] = t;
        renderAdmin();
      }
      return;
    }
    if (acao && acao.indexOf("loja-") === 0){ acaoLoja(acao, id); return; }
    if (acao === "secao-editar"){ editarSecao(id); return; }
    if (acao === "secao-nova"){ editarSecao(null); return; }

    if (acao === "trocar-senha"){
      const aviso = document.getElementById("aviso-senha");
      const s1 = document.getElementById("nova-senha-1").value;
      const s2 = document.getElementById("nova-senha-2").value;
      if (s1.length < 6){ aviso.textContent = "A senha precisa de pelo menos 6 caracteres."; return; }
      if (s1 !== s2){ aviso.textContent = "As duas senhas não são iguais."; return; }
      try {
        await auth.currentUser.updatePassword(s1);
        document.getElementById("nova-senha-1").value = "";
        document.getElementById("nova-senha-2").value = "";
        aviso.textContent = "Senha trocada. Use a nova na próxima vez que entrar.";
      } catch (err) {
        aviso.textContent = err && err.code === "auth/requires-recent-login"
          ? "Por segurança, saia e entre de novo antes de trocar a senha."
          : (err && err.code === "auth/weak-password" ? "Senha fraca demais. Use pelo menos 6 caracteres." : "Não deu para trocar a senha agora.");
      }
      return;
    }
    if (acao === "copiar-link"){
      const url = (dados.site.url || "").trim();
      try { await navigator.clipboard.writeText(url); bt.textContent = "Copiado!"; }
      catch (err) { bt.textContent = "Copie da caixa acima"; }
      setTimeout(() => bt.textContent = "Copiar link", 2000);
    }
  });

  corpoAdmin.addEventListener("change", async e => {
    if (e.target.id === "arquivo-foto"){
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const peso = document.getElementById("peso-foto");
      if (peso) peso.textContent = "Processando…";
      try {
        fotoPendente = await processarFoto(file);
        const p = document.getElementById("previa");
        if (p){
          const img = document.createElement("img");
          img.className = "mini";
          img.id = "previa"; img.src = fotoPendente; img.alt = "";
          p.replaceWith(img);
        }
        if (peso) peso.textContent = Math.round(fotoPendente.length / 1400) + " KB aprox.";
      } catch (err) {
        if (peso) peso.textContent = "Não consegui ler essa imagem. Tente outra.";
      }
      return;
    }
    const nomeCampo = e.target.dataset ? e.target.dataset.campo : null;
    // trocar a seção no formulário pode mostrar ou esconder o segundo preço:
    // redesenha guardando o que já foi digitado
    if (nomeCampo === "secao" && e.target.closest("#form-item")){
      rascunho = lerFormulario();
      renderAdmin();
      return;
    }
    if (nomeCampo && nomeCampo.indexOf("site.") === 0){
      dados.site[nomeCampo.slice(5)] = e.target.value.trim();
      marcarSujo();
    }
  });

  function rolarAoForm(){
    const f = document.getElementById("form-item");
    if (f) f.scrollIntoView({block:"start", behavior:"smooth"});
  }

  function mover(id, passo){
    const it = dados.itens.find(x => x.id === id);
    if (!it) return;
    const irmaos = itensDa(it.secao);
    const alvo = irmaos[irmaos.indexOf(it) + passo];
    if (!alvo) return;
    const a = dados.itens.indexOf(it), b = dados.itens.indexOf(alvo);
    dados.itens[a] = alvo; dados.itens[b] = it;
    renderAdmin();
  }

  // Os campos do formulário do item, como estão na tela agora.
  function lerFormulario(){
    const form = document.getElementById("form-item");
    if (!form) return null;
    const val = k => {
      const el = form.querySelector(`[data-campo="${k}"]`);
      if (!el) return "";
      return el.type === "checkbox" ? el.checked : el.value.trim();
    };
    return { secao: val("secao"), nome: val("nome"), desc: val("desc"), preco: val("preco"),
             preco2: val("preco2"), tag: val("tag"), esgotado: !!val("esgotado") };
  }

  function salvarItem(){
    const f = lerFormulario();
    if (!f) return;
    if (!f.nome){ window.alert("O prato precisa de um nome."); return; }
    // segundo preço só vale em seção com duas colunas
    if (!colunasDe(dados.secoes.find(s => s.id === f.secao) || {})) f.preco2 = "";
    if (editando === "novo"){
      dados.itens.push(Object.assign({ id: "i" + Date.now().toString(36) }, f, { foto: fotoPendente || "" }));
    } else {
      const it = dados.itens.find(x => x.id === editando);
      if (it){
        Object.assign(it, f);
        if (fotoPendente !== null) it.foto = fotoPendente;
      }
    }
    editando = null; fotoPendente = null; rascunho = null;
    renderAdmin();
  }

  function editarSecao(id){
    const s = id ? dados.secoes.find(x => x.id === id) : null;
    const nome = window.prompt("Nome da seção:", s ? s.nome : "");
    if (nome === null || !nome.trim()) return;
    const nota = window.prompt("Frase abaixo do título (pode deixar vazio):", s ? (s.nota || "") : "");
    if (nota === null) return;
    if (s && s.estilo === "quadro"){
      // cada caixa de texto: título e conteúdo
      const quadros = (s.quadros || []).map(q => Object.assign({}, q));
      for (const q of quadros){
        const t = window.prompt(`Texto da caixa "${q.titulo}":`, q.texto || "");
        if (t === null) return;
        q.texto = t.trim();
      }
      s.nome = nome.trim(); s.nota = nota.trim(); s.quadros = quadros;
      renderAdmin();
      return;
    }
    const atual = s && colunasDe(s) ? s.colunas.join(" / ") : "";
    const col = window.prompt("Dois preços por item? Escreva os nomes separados por / (ex.: Simples / Especial). Deixe vazio para um preço só.", atual);
    if (col === null) return;
    const partes = col.split("/").map(x => x.trim()).filter(Boolean);
    const colunas = partes.length === 2 ? partes : null;
    if (s){
      s.nome = nome.trim(); s.nota = nota.trim();
      if (colunas) s.colunas = colunas; else delete s.colunas;
    } else {
      const slug = nome.trim().toLowerCase().normalize("NFD").replace(ACENTOS, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || ("s" + Date.now().toString(36));
      if (dados.secoes.some(x => x.id === slug)){ avisar("Já existe uma seção com esse nome.", true); return; }
      const nova = { id: slug, nome: nome.trim(), sobre: "", nota: nota.trim(), estilo: "carta" };
      if (colunas) nova.colunas = colunas;
      dados.secoes.push(nova);
    }
    renderAdmin();
  }

  /* -------- publicar: grava só o que mudou -------- */
  btPublicar.addEventListener("click", async () => {
    if (!auth.currentUser || !ehDono || !papel || !papel.rede){ mostrarTranca("Entre de novo para publicar."); return; }
    publicando = true;
    btPublicar.disabled = true;
    btPublicar.textContent = "Publicando…";
    try {
      const lote = db.batch();
      let escritas = 0;

      if (estavel({ site: dados.site, secoes: dados.secoes }) !== estavel({ site: original.site, secoes: original.secoes })){
        lote.update(refRest, { site: dados.site, secoes: dados.secoes,
                               atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() });
        escritas++;
      }
      const antes = new Map(original.itens.map((it, i) => [it.id, { it, i }]));
      dados.itens.forEach((it, i) => {
        const velho = antes.get(it.id);
        if (!velho || estavel(velho.it) !== estavel(it)){
          // prato novo ou alterado: grava inteiro
          const campos = Object.assign({}, it); delete campos.id;
          campos.ordem = i;
          lote.set(refItens.doc(it.id), campos);
          escritas++;
        } else if (velho.i !== i){
          // só mudou de posição: grava só a posição, sem reenviar a foto
          lote.update(refItens.doc(it.id), { ordem: i });
          escritas++;
        }
      });
      const ficam = new Set(dados.itens.map(it => it.id));
      original.itens.forEach(it => { if (!ficam.has(it.id)){ lote.delete(refItens.doc(it.id)); escritas++; } });

      if (escritas > 450) throw Object.assign(new Error("mudanças demais de uma vez"), { code: "muitas" });
      if (escritas) await lote.commit();
      original = clonar(dados);
      avisar("Publicado. Os clientes já estão vendo.");
    } catch (err) {
      console.error("Falha ao publicar:", err);
      const c = err && err.code;
      if (c === "permission-denied")    avisar("Esta conta não tem permissão para alterar este cardápio.", true);
      else if (c === "unavailable")     avisar("Sem conexão. Nada foi perdido: tente publicar de novo.", true);
      else if (c === "muitas")          avisar("Mudanças demais de uma vez. Publique em partes.", true);
      else if (c === "invalid-argument")avisar("Alguma foto ficou grande demais. Troque por uma menor.", true);
      else                              avisar("Não deu para publicar agora. Tente de novo.", true);
    } finally {
      publicando = false;
      btPublicar.textContent = "Publicar";
      marcarSujo();
    }
  });

  btDescartar.addEventListener("click", () => {
    if (!window.confirm("Descartar as alterações que ainda não foram publicadas?")) return;
    dados = clonar(original);
    editando = null; fotoPendente = null; rascunho = null;
    renderCliente();
    renderAdmin();
  });

  window.addEventListener("beforeunload", e => {
    if (sujo && !publicando){ e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------------- partida ---------------- */
  estadoDaPagina("Carregando o cardápio…");
  if (location.hash === "#admin") abrirAdmin();
})();
