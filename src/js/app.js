// =====================================================
// ESTADO DA APLICAÇÃO
// =====================================================
let db;
let dbPronto = false;
let produtos = [], carrinho = [], vendas = [];
let openSince = null, trocoInicial = 0, editandoId = null, usuarioLogado = null;
let sessaoAtualId = null, sessaoPendente = null;
let pgtoSelecionado = 'dinheiro';
let adminLogado = null, editandoUsuario = null;
let clockTimer = null, toastTimer;

// =====================================================
// CONSTANTES
// =====================================================
const PAGAMENTOS = { dinheiro:'Dinheiro', pix:'PIX', debito:'Débito', credito:'Crédito', fiado:'Fiado' };
const VENDAS_POR_PAGINA = 50;

const hoje = () => new Date().toISOString().slice(0,10);
const fmt  = v => 'R$ '+Number(v).toFixed(2).replace('.',',');

let vendaOffset = 0;
let totalVendasSemFiltro = 0;
let avulsoCounter = 0;

// =====================================================
// HELPERS
// =====================================================
function calcDuracao(inicio) {
  const diff = inicio ? Math.floor((Date.now() - new Date(inicio)) / 1000) : 0;
  const hh = String(Math.floor(diff / 3600)).padStart(2,'0');
  const mm = String(Math.floor((diff % 3600) / 60)).padStart(2,'0');
  return { hh, mm, str: `${hh}h${mm}min` };
}

function handleError(e, msg, displayEl) {
  console.error(msg, e);
  if (displayEl) {
    displayEl.textContent = msg + (e?.message ? ': ' + e.message : '');
    displayEl.classList.add('show');
  } else {
    showToast(msg, 'red');
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// =====================================================
// SEGURANÇA — HASH DE SENHAS (PBKDF2 / Web Crypto API)
// =====================================================
function gerarSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

async function hashSenha(senha, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt:enc.encode(salt), iterations:100000, hash:'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// =====================================================
// INDEXEDDB
// =====================================================
function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('MercadinhoDB_v4', 3);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('usuarios'))
        d.createObjectStore('usuarios', { keyPath:'usuario' });
      if (!d.objectStoreNames.contains('produtos'))
        d.createObjectStore('produtos', { keyPath:'id', autoIncrement:true });
      if (!d.objectStoreNames.contains('vendas')) {
        const s = d.createObjectStore('vendas', { keyPath:'id', autoIncrement:true });
        s.createIndex('data','data',{unique:false});
      }
      if (!d.objectStoreNames.contains('caixa'))
        d.createObjectStore('caixa', { keyPath:'chave' });
      if (!d.objectStoreNames.contains('sessoes')) {
        const s = d.createObjectStore('sessoes', { keyPath:'id', autoIncrement:true });
        s.createIndex('data','data',{unique:false});
      }
      if (!d.objectStoreNames.contains('auditoria')) {
        const a = d.createObjectStore('auditoria', { keyPath:'id', autoIncrement:true });
        a.createIndex('data','data',{unique:false});
        a.createIndex('usuario','usuario',{unique:false});
      }
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror = () => rej(req.error);
  });
}

// =====================================================
// AUDITORIA (6.1)
// =====================================================
async function registrarAudit(acao, detalhe) {
  const agora = new Date();
  try {
    await dbAdd('auditoria', {
      data:    agora.toISOString().slice(0,10),
      hora:    agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      usuario: usuarioLogado || adminLogado || '—',
      acao,
      detalhe: detalhe || '',
      criadoEm: agora.toISOString(),
    });
  } catch(e) { console.error('Erro ao registrar auditoria:', e); }
}

function dbGet(s,k)    {
  return new Promise((res,rej)=>{
    try {
      const tx = db.transaction(s,'readonly');
      const req = tx.objectStore(s).get(k);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('dbGet falhou: '+req.error));
    } catch(e){ rej(e); }
  });
}
function dbGetAll(s) {
  return new Promise((res,rej)=>{
    try {
      const tx = db.transaction(s,'readonly');
      const req = tx.objectStore(s).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('dbGetAll falhou: '+req.error));
    } catch(e){ rej(e); }
  });
}
function dbPut(s,o) {
  return new Promise((res,rej)=>{
    try {
      const tx = db.transaction(s,'readwrite');
      const req = tx.objectStore(s).put(o);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('dbPut falhou: '+req.error));
    } catch(e){ rej(e); }
  });
}
function dbAdd(s,o) {
  return new Promise((res,rej)=>{
    try {
      const tx = db.transaction(s,'readwrite');
      const req = tx.objectStore(s).add(o);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('dbAdd falhou: '+req.error));
      tx.onerror    = () => rej(new Error('transação falhou: '+tx.error));
    } catch(e){ rej(e); }
  });
}
function dbDelete(s,k) {
  return new Promise((res,rej)=>{
    try {
      const tx = db.transaction(s,'readwrite');
      const req = tx.objectStore(s).delete(k);
      req.onsuccess = () => res();
      req.onerror   = () => rej(new Error('dbDelete falhou: '+req.error));
    } catch(e){ rej(e); }
  });
}
function dbByIdx(s,i,v) {
  return new Promise((res,rej)=>{
    try {
      const tx = db.transaction(s,'readonly');
      const req = tx.objectStore(s).index(i).getAll(v);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('dbByIdx falhou: '+req.error));
    } catch(e){ rej(e); }
  });
}

// Cursor reverso: retorna até `limit` registros a partir do `offset` mais recente
function dbGetPage(storeName, limit, offset) {
  return new Promise((res, rej) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const results = [];
      let skipped = 0;
      const req = tx.objectStore(storeName).openCursor(null, 'prev');
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { res(results); return; }
        if (skipped < offset) { skipped++; cursor.continue(); return; }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => rej(new Error('dbGetPage falhou'));
    } catch(e) { rej(e); }
  });
}

function dbCount(storeName) {
  return new Promise((res, rej) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('dbCount falhou'));
    } catch(e) { rej(e); }
  });
}

// =====================================================
// SEED (dados iniciais de exemplo)
// =====================================================
const SEED = [
  {nome:'Pão Francês',        barras:'',categoria:'Padaria',        unidade:'un',preco:0.75, custo:0.40,estoque:98, vendidos:120},
  {nome:'Água Mineral 500ml', barras:'',categoria:'Bebidas',        unidade:'un',preco:2.00, custo:1.10,estoque:53, vendidos:95},
  {nome:'Leite Integral 1L',  barras:'',categoria:'Laticínios',     unidade:'un',preco:4.50, custo:3.20,estoque:32, vendidos:80},
  {nome:'Açúcar 1kg',         barras:'',categoria:'Mercearia',      unidade:'un',preco:4.20, custo:2.90,estoque:40, vendidos:75},
  {nome:'Café 500g',          barras:'',categoria:'Mercearia',      unidade:'un',preco:12.50,custo:8.80,estoque:18, vendidos:68},
  {nome:'Refrigerante 2L',    barras:'',categoria:'Bebidas',        unidade:'un',preco:8.90, custo:5.60,estoque:25, vendidos:62},
  {nome:'Arroz 5kg',          barras:'',categoria:'Grãos e Cereais',unidade:'un',preco:22.90,custo:16.0,estoque:15, vendidos:45},
  {nome:'Óleo de Soja 900ml', barras:'',categoria:'Mercearia',      unidade:'un',preco:6.90, custo:5.00,estoque:22, vendidos:40},
  {nome:'Feijão Carioca 1kg', barras:'',categoria:'Grãos e Cereais',unidade:'un',preco:7.80, custo:5.50,estoque:20, vendidos:35},
  {nome:'Macarrão 500g',      barras:'',categoria:'Mercearia',      unidade:'un',preco:3.50, custo:2.20,estoque:30, vendidos:28},
  {nome:'Frango KG',          barras:'',categoria:'Carnes',         unidade:'kg', preco:12.00,custo:8.50,estoque:10, vendidos:20},
  {nome:'Banana Prata',       barras:'',categoria:'Hortifruti',     unidade:'kg', preco:4.50, custo:2.80,estoque:8,  vendidos:15},
];

// =====================================================
// LOGIN — verifica contra banco de dados
// =====================================================
async function fazerLogin() {
  const u = document.getElementById('login-user').value.trim().toLowerCase();
  const p = document.getElementById('login-pass').value;
  const err = document.getElementById('login-err');
  if (!u || !p) { err.textContent='Preencha usuário e senha.'; err.classList.add('show'); return; }
  if (!dbPronto) { err.textContent='Sistema iniciando, aguarde...'; err.classList.add('show'); return; }
  try {
    const reg = await dbGet('usuarios', u);
    let senhaCorreta = false;
    if (reg) {
      if (reg.salt) {
        const hash = await hashSenha(p, reg.salt);
        senhaCorreta = hash === reg.senha;
      } else {
        // Migração: senha antiga em plaintext → converte para hash no primeiro login
        senhaCorreta = reg.senha === p;
        if (senhaCorreta) {
          const salt = gerarSalt();
          reg.senha = await hashSenha(p, salt);
          reg.salt = salt;
          await dbPut('usuarios', reg);
        }
      }
    }
    if (senhaCorreta) {
      err.classList.remove('show');
      usuarioLogado = u;
      await registrarAudit('LOGIN', `Usuário "${u}" fez login`);
      document.getElementById('tela-login').classList.add('hidden');
      await iniciarApp();
    } else {
      err.textContent='Usuário ou senha incorretos.';
      err.classList.add('show');
      document.getElementById('login-pass').value='';
      document.getElementById('login-pass').focus();
    }
  } catch(e) {
    err.textContent='Erro ao acessar banco de dados.';
    err.classList.add('show');
  }
}

function logout() {
  pararTimeoutSessao();
  registrarAudit('LOGOUT', `Usuário "${usuarioLogado}" encerrou a sessão`);
  usuarioLogado=null; openSince=null; carrinho=[];
  document.getElementById('tela-login').classList.remove('hidden');
  document.getElementById('topbar').style.display='none';
  document.getElementById('app-layout').style.display='none';
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
}

async function iniciarApp() {
  document.getElementById('topbar-user').textContent='👤 '+usuarioLogado;

  // 2.1 — Verificar sessão incompleta do mesmo operador
  const todasSessoes = await dbGetAll('sessoes');
  sessaoPendente = todasSessoes.find(s => s.status === 'aberta' && s.operador === usuarioLogado) || null;

  if (sessaoPendente) {
    const abertura = new Date(sessaoPendente.abertoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    document.getElementById('recovery-info').textContent =
      `Caixa aberto em ${abertura} pelo operador "${usuarioLogado}" não foi fechado corretamente.`;
    document.getElementById('modal-recovery').classList.add('open');
    return;
  }

  await abrirNovaSessao();
}

async function recuperarSessaoPendente() {
  document.getElementById('modal-recovery').classList.remove('open');
  sessaoAtualId = sessaoPendente.id;
  openSince = new Date(sessaoPendente.abertoEm);
  const estado = await dbGet('caixa', 'estado');
  trocoInicial = estado?.trocoInicial || 0;
  sessaoPendente = null;
  mostrarApp();
}

async function descartarSessaoPendente() {
  document.getElementById('modal-recovery').classList.remove('open');
  try {
    const s = await dbGet('sessoes', sessaoPendente.id);
    if (s) { s.status = 'descartada'; await dbPut('sessoes', s); }
  } catch(e) { handleError(e, 'Erro ao descartar sessão'); }
  sessaoPendente = null;
  await abrirNovaSessao();
}

async function abrirNovaSessao() {
  openSince = new Date();
  trocoInicial = 0;
  await dbPut('caixa',{chave:'estado',aberto:true,abertoEm:openSince.toISOString(),trocoInicial:0});
  await registrarAudit('ABRIR_CAIXA', `Caixa aberto pelo operador "${usuarioLogado}"`);
  const sessao = {
    data: hoje(),
    operador: usuarioLogado,
    abertoEm: openSince.toISOString(),
    abertoHora: openSince.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
    fechadoEm: null,
    fechadoHora: null,
    duracao: null,
    totalVendas: 0,
    numVendas: 0,
    status: 'aberta'
  };
  sessaoAtualId = await dbAdd('sessoes', sessao);
  mostrarApp();
}

// =====================================================
// CAIXA
// =====================================================
function mostrarApp() {
  document.getElementById('topbar').style.display='flex';
  document.getElementById('app-layout').style.display='flex';
  iniciarTimeoutSessao();
  updateClock();
  renderCaixa();
}

function fecharCaixa() {
  const totalV=vendas.reduce((s,v)=>s+v.total,0);
  const { hh, mm } = calcDuracao(openSince);
  const ab=openSince?openSince.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'--';
  const fe=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('resumo-fechamento').innerHTML=`
    <div class="fechamento-row"><span class="fl">Abertura</span><span class="fv">${ab}</span></div>
    <div class="fechamento-row"><span class="fl">Fechamento</span><span class="fv">${fe}</span></div>
    <div class="fechamento-row"><span class="fl">Tempo aberto</span><span class="fv">${hh}h${mm}min</span></div>
    <div class="fechamento-row"><span class="fl">Troco inicial</span><span class="fv">${fmt(trocoInicial)}</span></div>
    <div class="fechamento-row"><span class="fl">Nº de vendas</span><span class="fv">${vendas.length}</span></div>
    <div class="fechamento-row"><span class="fl">Total em vendas</span><span class="fv green">${fmt(totalV)}</span></div>
    <div class="fechamento-row"><span class="fl">Total em caixa</span><span class="fv green">${fmt(totalV+trocoInicial)}</span></div>`;
  document.getElementById('modal-fechamento').classList.add('open');
}

async function confirmarFechamento() {
  const totalV = vendas.reduce((s,v)=>s+v.total,0);
  const agora = new Date();
  const { hh, mm, str: durStr } = calcDuracao(openSince);

  // Salvar sessão fechada no banco
  if(sessaoAtualId) {
    try {
      const sessao = await dbGet('sessoes', sessaoAtualId);
      if(sessao) {
        sessao.fechadoEm   = agora.toISOString();
        sessao.fechadoHora = agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        sessao.duracao     = durStr;
        sessao.totalVendas = totalV;
        sessao.numVendas   = vendas.length;
        sessao.status      = 'fechada';
        await dbPut('sessoes', sessao);
      }
    } catch(e){ handleError(e, 'Erro ao salvar sessão'); }
  }

  await registrarAudit('FECHAR_CAIXA', `Caixa fechado — ${vendas.length} vendas, total ${fmt(totalV)}`);
  await dbPut('caixa',{chave:'estado',aberto:false});
  document.getElementById('modal-fechamento').classList.remove('open');
  document.getElementById('topbar').style.display='none';
  document.getElementById('app-layout').style.display='none';
  vendas=[];carrinho=[];openSince=null;trocoInicial=0;sessaoAtualId=null;
  document.getElementById('tela-login').classList.remove('hidden');
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
  navTo('caixa');
  showToast('Caixa fechado. Até logo!');
}

function updateClock() {
  if(!openSince) return;
  const d=Math.floor((Date.now()-openSince)/1000);
  document.getElementById('clock-display').textContent=
    String(Math.floor(d/3600)).padStart(2,'0')+':'+String(Math.floor((d%3600)/60)).padStart(2,'0');
}
function iniciarClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(updateClock, 1000);
}
iniciarClock();

const renderCaixaDebounced   = debounce(renderCaixa, 300);
const renderEstoqueDebounced = debounce(renderEstoque, 300);

function navTo(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.getElementById('nav-'+page).classList.add('active');
  if(page==='estoque') renderEstoque();
  if(page==='vendas'){const f=document.getElementById('filtro-data');if(!f.value)f.value=hoje();renderVendas();}
}

// =====================================================
// CAIXA - TOP 10
// =====================================================
function renderCaixa() {
  const q=(document.getElementById('search-input')?.value||'').trim().toLowerCase();
  const grid=document.getElementById('produtos-grid');
  grid.innerHTML='';
  let lista;
  if(q){
    lista=produtos.filter(p=>p.nome.toLowerCase().includes(q)||(p.barras||'').includes(q));
  } else {
    lista=[...produtos].sort((a,b)=>(b.vendidos||0)-(a.vendidos||0)).slice(0,10);
  }
  if(lista.length===0){
    grid.innerHTML='<div style="color:var(--muted);font-size:14px;font-weight:600;padding:20px 0;grid-column:1/-1">Nenhum produto encontrado.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  lista.forEach((p,i)=>{
    const card=document.createElement('div');
    card.className='produto-card'+(p.estoque<=0?' sem-estoque':'');
    const un=p.unidade||'un';
    card.innerHTML=`
      ${!q&&i<3?`<div class="top-rank">#${i+1}</div>`:''}
      <div class="p-nome">${p.nome}</div>
      <div class="p-cat">${p.categoria||''}</div>
      <div class="p-preco">${fmt(p.preco)}<span style="font-size:11px;color:var(--muted);font-weight:600;margin-left:2px">/${un}</span></div>
      <div class="p-footer">
        <span class="p-estoque">${p.estoque} ${un}</span>
        <button class="btn-add" onclick="addCarrinho(${p.id})">+</button>
      </div>`;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

// =====================================================
// CARRINHO
// =====================================================
function addCarrinho(id){
  const p=produtos.find(x=>x.id===id);
  if(!p||p.estoque<=0) return;
  const item=carrinho.find(x=>x.id===id);
  if(item){
    if(item.qty>=p.estoque){showToast('Estoque insuficiente!','red');return;}
    item.qty++;
  } else {
    carrinho.push({id,nome:p.nome,preco:p.preco,unidade:p.unidade||'un',qty:1});
  }
  renderCarrinho();
  showToast(p.nome+' adicionado',true);
}

function changeQty(id,delta){
  const idx=carrinho.findIndex(x=>x.id===id);
  if(idx===-1) return;
  carrinho[idx].qty+=delta;
  if(carrinho[idx].qty<=0) carrinho.splice(idx,1);
  renderCarrinho();
}

function renderCarrinho(){
  const empty=carrinho.length===0;
  document.getElementById('carr-vazio').style.display=empty?'flex':'none';
  document.getElementById('carr-items').style.display=empty?'none':'flex';
  document.getElementById('carr-footer').style.display=empty?'none':'block';
  const el=document.getElementById('carr-items');
  el.innerHTML='';
  let total=0;
  const frag=document.createDocumentFragment();
  carrinho.forEach(item=>{
    total+=item.preco*item.qty;
    const d=document.createElement('div');
    d.className='carrinho-item';
    d.innerHTML=`
      <div class="ci-nome">${item.nome}</div>
      <div class="ci-ctrl">
        <button class="btn-qty" onclick="changeQty(${item.id},-1)">−</button>
        <span class="ci-qty">${item.qty}</span>
        <button class="btn-qty" onclick="changeQty(${item.id},1)">+</button>
      </div>
      <div class="ci-preco">${fmt(item.preco*item.qty)}</div>`;
    frag.appendChild(d);
  });
  el.appendChild(frag);
  document.getElementById('total-value').textContent=fmt(total);
}

function limparCarrinho(){carrinho=[];renderCarrinho();}

// Tecla Enter no campo de busca (maquininha/leitor de código de barras)
function buscarPorEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = (document.getElementById('search-input')?.value || '').trim();
  if (!q) return;

  // Verifica match exato de código de barras (prioridade)
  const exato = produtos.find(p => (p.barras || '') === q);
  if (exato) {
    addCarrinho(exato.id);
    document.getElementById('search-input').value = '';
    renderCaixa();
    return;
  }

  // Se só tem um resultado, adiciona direto
  const qLower = q.toLowerCase();
  const lista = produtos.filter(p => p.nome.toLowerCase().includes(qLower) || (p.barras || '').includes(q));
  if (lista.length === 1) {
    addCarrinho(lista[0].id);
    document.getElementById('search-input').value = '';
    renderCaixa();
  } else if (lista.length === 0) {
    showToast('Produto não encontrado', 'red');
  }
  // Se múltiplos resultados: mantém a lista visível para o operador escolher
}

// =====================================================
// VALOR AVULSO (sem código de barras)
// =====================================================
function abrirAvulso() {
  document.getElementById('av-desc').value = '';
  document.getElementById('av-preco').value = '';
  const err = document.getElementById('av-err');
  err.textContent = '';
  err.classList.remove('show');
  document.getElementById('modal-avulso').classList.add('open');
  setTimeout(() => document.getElementById('av-preco').focus(), 80);
}

function fecharAvulso() {
  document.getElementById('modal-avulso').classList.remove('open');
}

function confirmarAvulso() {
  const desc = document.getElementById('av-desc').value.trim() || 'Item Avulso';
  const precoStr = document.getElementById('av-preco').value.replace(',', '.');
  const preco = parseFloat(precoStr);
  const err = document.getElementById('av-err');

  if (isNaN(preco) || preco <= 0) {
    err.textContent = 'Informe um valor maior que zero.';
    err.classList.add('show');
    return;
  }

  avulsoCounter--;
  carrinho.push({ id: avulsoCounter, nome: desc, preco, unidade: 'un', qty: 1 });
  renderCarrinho();
  showToast(desc + ' adicionado', true);
  fecharAvulso();
}

// =====================================================
// MODAL PAGAMENTO
// =====================================================

function finalizarVenda() {
  if(carrinho.length===0) return;
  const total = carrinho.reduce((s,i)=>s+i.preco*i.qty, 0);
  document.getElementById('venda-total-display').textContent = fmt(total);
  document.getElementById('valor-recebido').value = '';
  document.getElementById('troco-display').style.display = 'none';
  selecionarPgto('dinheiro');
  document.getElementById('modal-venda').classList.add('open');
}

function selecionarPgto(tipo) {
  pgtoSelecionado = tipo;
  document.querySelectorAll('.pgto-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('pgto-'+tipo).classList.add('active');
  const vrBox = document.getElementById('valor-recebido-box');
  // Só mostra "valor recebido" para dinheiro
  vrBox.style.display = tipo==='dinheiro' ? 'block' : 'none';
  const btn = document.getElementById('btn-confirmar-venda');
  if(tipo!=='dinheiro'){
    btn.style.opacity='1'; btn.style.cursor='pointer'; btn.disabled=false;
    document.getElementById('troco-display').style.display='none';
  } else {
    btn.style.opacity='.5'; btn.style.cursor='not-allowed'; btn.disabled=true;
  }
}

function calcularTroco() {
  const total = carrinho.reduce((s,i)=>s+i.preco*i.qty, 0);
  const recebido = parseFloat(document.getElementById('valor-recebido').value)||0;
  const btn = document.getElementById('btn-confirmar-venda');
  const trocoBox = document.getElementById('troco-display');
  if(recebido >= total) {
    const troco = recebido - total;
    document.getElementById('troco-valor').textContent = fmt(troco);
    trocoBox.style.display = 'block';
    btn.style.opacity='1'; btn.style.cursor='pointer'; btn.disabled=false;
  } else {
    trocoBox.style.display = 'none';
    btn.style.opacity='.5'; btn.style.cursor='not-allowed'; btn.disabled=true;
  }
}

async function confirmarVenda() {
  if(carrinho.length===0) return;
  document.getElementById('modal-venda').classList.remove('open');
  const total = carrinho.reduce((s,i)=>s+i.preco*i.qty, 0);
  const recebido = parseFloat(document.getElementById('valor-recebido').value)||total;
  const troco = pgtoSelecionado==='dinheiro' ? Math.max(0, recebido-total) : 0;
  const itensStr = carrinho.map(i=>`${i.qty}x ${i.nome}`).join(', ');
  const agora = new Date();
  const hora = agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

  for(const ci of carrinho){
    const p=produtos.find(x=>x.id===ci.id);
    if(p){p.estoque=Math.max(0,p.estoque-ci.qty);p.vendidos=(p.vendidos||0)+ci.qty;await dbPut('produtos',p);}
  }

  const pgtoLabel = PAGAMENTOS[pgtoSelecionado];
  const venda={data:hoje(),hora,itensStr,total,pagamento:pgtoLabel,recebido,troco,criadoEm:agora.toISOString()};
  const vid=await dbAdd('vendas',venda);
  venda.id=vid; vendas.unshift(venda);

  carrinho=[];
  renderCarrinho();
  renderCaixa();

  await registrarAudit('VENDA', `Venda #${vid} — ${fmt(total)} (${pgtoLabel}) — ${itensStr}`);
  let msg = `Venda #${vid} — ${fmt(total)} (${pgtoLabel})`;
  if(pgtoSelecionado==='dinheiro' && troco>0) msg += ` · Troco: ${fmt(troco)}`;
  showToast(msg, true);
}

// =====================================================
// ESTOQUE
// =====================================================
let estoqueSelecionados = new Set();

function renderEstoque(){
  const q=(document.getElementById('estoque-busca')?.value||'').toLowerCase();
  const lista=q?produtos.filter(p=>p.nome.toLowerCase().includes(q)||(p.barras||'').includes(q)):[...produtos];
  const tbody=document.getElementById('estoque-tbody');
  tbody.innerHTML='';
  if(lista.length===0){
    tbody.innerHTML='<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:28px">Nenhum produto encontrado.</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  lista.forEach(p=>{
    const un=p.unidade||'un';
    const badge=p.estoque<=0?'<span class="badge-zero">Zerado</span>':p.estoque<=10?'<span class="badge-baixo">Baixo</span>':'<span class="badge-ok">Normal</span>';
    const margem=p.custo>0?`<span style="color:var(--green);font-weight:700">${(((p.preco-p.custo)/p.custo)*100).toFixed(0)}%</span>`:'—';
    const checked = estoqueSelecionados.has(p.id) ? 'checked' : '';
    const tr=document.createElement('tr');
    tr.style.background = estoqueSelecionados.has(p.id) ? '#fef2f2' : '';
    tr.innerHTML=`
      <td><input type="checkbox" ${checked} onchange="toggleSelecionarEstoque(${p.id}, this.checked)" style="cursor:pointer;width:16px;height:16px"></td>
      <td><strong>${p.nome}</strong></td>
      <td style="color:var(--muted);font-size:12px">${p.barras||'—'}</td>
      <td>${p.categoria||'—'}</td>
      <td><span style="background:var(--bg);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${un.toUpperCase()}</span></td>
      <td style="color:var(--green);font-weight:700">${fmt(p.preco)}</td>
      <td>${p.custo>0?fmt(p.custo):'—'}</td>
      <td>${margem}</td>
      <td>${p.estoque} ${un}</td>
      <td>${badge}</td>
      <td style="white-space:nowrap">
        <button class="btn-edit" onclick="abrirEditar(${p.id})">✏️</button>
        <button class="btn-del"  onclick="deletarProduto(${p.id})">🗑️</button>
      </td>`;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  _atualizarToolbarEstoque();
}

function toggleSelecionarEstoque(id, checked) {
  checked ? estoqueSelecionados.add(id) : estoqueSelecionados.delete(id);
  _atualizarToolbarEstoque();
  // Atualiza cor da linha
  const checkboxes = document.querySelectorAll('#estoque-tbody input[type=checkbox]');
  checkboxes.forEach(cb => {
    const pid = parseInt(cb.getAttribute('onchange').match(/\d+/)[0]);
    cb.closest('tr').style.background = estoqueSelecionados.has(pid) ? '#fef2f2' : '';
  });
  // Atualiza "marcar todos"
  const lista = document.querySelectorAll('#estoque-tbody input[type=checkbox]');
  const checkAll = document.getElementById('estoque-check-all');
  if(checkAll) checkAll.checked = lista.length > 0 && [...lista].every(c => c.checked);
}

function selecionarTodosEstoque(checked) {
  const checkboxes = document.querySelectorAll('#estoque-tbody input[type=checkbox]');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    const pid = parseInt(cb.getAttribute('onchange').match(/\d+/)[0]);
    checked ? estoqueSelecionados.add(pid) : estoqueSelecionados.delete(pid);
    cb.closest('tr').style.background = checked ? '#fef2f2' : '';
  });
  const checkAll = document.getElementById('estoque-check-all');
  if(checkAll) checkAll.checked = checked;
  _atualizarToolbarEstoque();
}

function _atualizarToolbarEstoque() {
  const toolbar = document.getElementById('estoque-toolbar');
  const count   = document.getElementById('estoque-toolbar-count');
  if (!toolbar) return;
  if (estoqueSelecionados.size > 0) {
    toolbar.style.display = 'flex';
    count.textContent = `${estoqueSelecionados.size} produto(s) selecionado(s)`;
  } else {
    toolbar.style.display = 'none';
  }
}

function excluirSelecionadosEstoque() {
  if (estoqueSelecionados.size === 0) return;
  const n = estoqueSelecionados.size;
  mostrarConfirmar(
    'Excluir Selecionados',
    `Excluir ${n} produto(s) selecionado(s) do estoque? Esta ação não pode ser desfeita.`,
    async () => {
      for (const id of estoqueSelecionados) {
        await dbDelete('produtos', id);
      }
      await registrarAudit('EXCLUIR_VARIOS', `${n} produtos excluídos em lote`);
      produtos = produtos.filter(p => !estoqueSelecionados.has(p.id));
      estoqueSelecionados.clear();
      renderEstoque();
      renderCaixa();
      showToast(`${n} produto(s) excluído(s)`, true);
    }
  );
}

function excluirTodosEstoque() {
  if (produtos.length === 0) { showToast('Nenhum produto no estoque.', 'red'); return; }
  mostrarConfirmar(
    'Apagar Todo o Estoque',
    `Apagar TODOS os ${produtos.length} produtos do estoque? Esta ação não pode ser desfeita.`,
    async () => {
      for (const p of produtos) await dbDelete('produtos', p.id);
      await registrarAudit('EXCLUIR_TUDO', `Todos os ${produtos.length} produtos excluídos`);
      produtos = [];
      estoqueSelecionados.clear();
      renderEstoque();
      renderCaixa();
      showToast('Estoque apagado completamente.', true);
    }
  );
}

// =====================================================
// MODAL PRODUTO
// =====================================================
function abrirModalProduto(){
  editandoId=null;
  document.getElementById('modal-titulo').textContent='Novo Produto';
  document.getElementById('btn-salvar-produto').textContent='Cadastrar';
  ['m-nome','m-barras','m-preco-venda','m-preco-custo','m-estoque'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('m-cat').value='Outros';
  document.getElementById('m-unidade').value='un';
  document.getElementById('bd-produto').classList.add('open');
  document.getElementById('modal-produto').classList.add('open');
  setTimeout(()=>document.getElementById('m-nome').focus(),80);
}

function abrirEditar(id){
  const p=produtos.find(x=>x.id===id);if(!p) return;
  editandoId=id;
  document.getElementById('modal-titulo').textContent='Editar Produto';
  document.getElementById('btn-salvar-produto').textContent='Salvar';
  document.getElementById('m-nome').value=p.nome;
  document.getElementById('m-barras').value=p.barras||'';
  document.getElementById('m-cat').value=p.categoria||'Outros';
  document.getElementById('m-preco-venda').value=String(p.preco).replace('.',',');
  document.getElementById('m-preco-custo').value=p.custo?String(p.custo).replace('.',','):'';
  document.getElementById('m-estoque').value=p.estoque;
  document.getElementById('m-unidade').value=p.unidade||'un';
  document.getElementById('bd-produto').classList.add('open');
  document.getElementById('modal-produto').classList.add('open');
}

function fecharModalProduto(){
  document.getElementById('bd-produto').classList.remove('open');
  document.getElementById('modal-produto').classList.remove('open');
}

function parseMoeda(v) {
  if(v===null||v===undefined||String(v).trim()==='') return NaN;
  return parseFloat(String(v).trim().replace(',','.'));
}

function fecharSucesso() {
  document.getElementById('modal-sucesso').classList.remove('open');
}

function fecharSucessoNovo() {
  document.getElementById('modal-sucesso').classList.remove('open');
  abrirModalProduto();
}

async function salvarProduto(){
  const nome      = document.getElementById('m-nome').value.trim();
  const barras    = document.getElementById('m-barras').value.trim();
  const categoria = document.getElementById('m-cat').value;
  const precoRaw  = document.getElementById('m-preco-venda').value;
  const custoRaw  = document.getElementById('m-preco-custo').value;
  const estoqueRaw= document.getElementById('m-estoque').value;
  const unidade   = document.getElementById('m-unidade').value;

  const preco   = parseMoeda(precoRaw);
  const custo   = parseMoeda(custoRaw) || 0;
  const estoque = Math.max(0, parseInt(estoqueRaw) || 0);

  if(!nome)                  { showToast('Informe o nome do produto!','red'); return; }
  if(isNaN(preco)||preco<=0) { showToast('Preço de venda inválido: "'+precoRaw+'"','red'); return; }
  if(!dbPronto)              { showToast('Banco não está pronto, aguarde.','red'); return; }

  // Verificar duplicatas (ignora o próprio produto ao editar)
  const outros = produtos.filter(p => p.id !== editandoId);

  const nomeRepetido = outros.find(p => p.nome.toLowerCase().trim() === nome.toLowerCase());
  if(nomeRepetido) {
    document.getElementById('duplicado-msg').textContent =
      'Já existe um produto com o nome "'+nomeRepetido.nome+'". Altere o nome antes de salvar.';
    document.getElementById('modal-duplicado').classList.add('open');
    return;
  }

  if(barras) {
    const barrasRepetido = outros.find(p => p.barras && p.barras.trim() === barras);
    if(barrasRepetido) {
      document.getElementById('duplicado-msg').textContent =
        'O código de barras '+barras+' já está cadastrado no produto "'+barrasRepetido.nome+'".';
      document.getElementById('modal-duplicado').classList.add('open');
      return;
    }
  }

  const btn = document.getElementById('btn-salvar-produto');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if(editandoId){
      const p = produtos.find(x=>x.id===editandoId);
      if(!p){ showToast('Produto não encontrado!','red'); return; }
      Object.assign(p,{nome,barras,categoria,preco,custo,estoque,unidade});
      await dbPut('produtos', p);
      await registrarAudit('EDITAR_PRODUTO', `Produto "${nome}" (id:${editandoId}) atualizado`);
      fecharModalProduto();
      renderEstoque();
      renderCaixa();
      showToast('✅ Produto atualizado com sucesso!', true);
    } else {
      const obj = {nome,barras,categoria,preco,custo,estoque,unidade,vendidos:0};
      const nid  = await dbAdd('produtos', obj);
      produtos.push({...obj, id:nid});
      await registrarAudit('CRIAR_PRODUTO', `Produto "${nome}" cadastrado (id:${nid})`);
      fecharModalProduto();
      renderEstoque();
      renderCaixa();
      document.getElementById('sucesso-msg').textContent =
        '"'+nome+'" foi adicionado ao estoque com sucesso!';
      document.getElementById('modal-sucesso').classList.add('open');
    }
  } catch(e) {
    console.error('Erro salvarProduto:', e);
    showToast('❌ Erro: '+e.message, 'red');
  } finally {
    btn.disabled = false;
    btn.textContent = editandoId ? 'Salvar' : 'Cadastrar';
  }
}

function deletarProduto(id){
  const p = produtos.find(x=>x.id===id);
  mostrarConfirmar('Excluir produto', `Excluir "${p?.nome || 'este produto'}" do estoque?`, async () => {
    await dbDelete('produtos', id);
    await registrarAudit('EXCLUIR_PRODUTO', `Produto "${p?.nome}" (id:${id}) excluído`);
    produtos = produtos.filter(x=>x.id!==id);
    renderEstoque(); renderCaixa();
    showToast('Produto removido');
  });
}

// =====================================================
// VENDAS
// =====================================================
function _criarLinhaVenda(v) {
  const d = document.createElement('div');
  d.className = 'venda-row';
  d.innerHTML = `
    <span class="venda-num">#${String(v.id).padStart(3,'0')}</span>
    <span class="venda-hora">${v.hora}</span>
    <span class="venda-items">${v.itensStr}</span>
    ${v.pagamento?`<span style="font-size:11px;font-weight:700;background:var(--green-light);color:var(--green-dark);padding:3px 8px;border-radius:20px;white-space:nowrap">${v.pagamento}</span>`:''}
    <span class="venda-total">${fmt(v.total)}</span>`;
  const btnDel = document.createElement('button');
  btnDel.className = 'btn-del-venda';
  btnDel.title = 'Excluir venda';
  btnDel.textContent = '🗑️';
  btnDel.addEventListener('click', () => confirmarExcluirVenda(v.id, v.hora, v.itensStr, fmt(v.total)));
  d.appendChild(btnDel);
  return d;
}

async function renderVendas(append = false) {
  const data = document.getElementById('filtro-data').value;
  const el   = document.getElementById('vendas-list');
  const btnMais = document.getElementById('btn-mais-vendas');

  if (!append) {
    vendaOffset = 0;
    el.innerHTML = '';
  }

  let lista, temMais = false;

  if (data) {
    // Filtro por data: carrega tudo do dia (pequeno volume)
    if (!append) {
      lista = await dbByIdx('vendas', 'data', data);
      lista.sort((a,b) => b.id - a.id);
      const tot = lista.reduce((s,v) => s+v.total, 0);
      document.getElementById('stat-total').textContent  = fmt(tot);
      document.getElementById('stat-num').textContent    = lista.length;
      document.getElementById('stat-ticket').textContent = lista.length ? fmt(tot/lista.length) : 'R$ 0,00';
    } else {
      lista = [];
    }
    temMais = false;
  } else {
    // Sem filtro: paginação cursor (mais recente primeiro)
    lista = await dbGetPage('vendas', VENDAS_POR_PAGINA, vendaOffset);
    vendaOffset += lista.length;

    if (!append) {
      totalVendasSemFiltro = await dbCount('vendas');
      // Stats: carrega totais separados para não bloquear o cursor
      const todasHoje = await dbByIdx('vendas', 'data', hoje());
      const totH = todasHoje.reduce((s,v) => s+v.total, 0);
      document.getElementById('stat-total').textContent  = fmt(totH);
      document.getElementById('stat-num').textContent    = todasHoje.length;
      document.getElementById('stat-ticket').textContent = todasHoje.length ? fmt(totH/todasHoje.length) : 'R$ 0,00';
    }
    temMais = vendaOffset < totalVendasSemFiltro;
  }

  if (lista.length === 0 && !append) {
    el.innerHTML = '<div style="color:var(--muted);font-size:14px;font-weight:600;padding:16px 0">Nenhuma venda encontrada.</div>';
  } else {
    const frag = document.createDocumentFragment();
    lista.forEach(v => frag.appendChild(_criarLinhaVenda(v)));
    el.appendChild(frag);
  }

  if (btnMais) btnMais.style.display = temMais ? 'block' : 'none';
}

function confirmarExcluirVenda(id, hora, itens, total){
  document.getElementById('excluir-venda-id').value = id;
  document.getElementById('excluir-venda-info').innerHTML =
    `<strong>#${String(id).padStart(3,'0')}</strong> · ${hora}<br>
     <span style="color:var(--muted);font-size:13px">${itens}</span><br>
     <span style="color:var(--green);font-weight:800;font-size:18px;display:block;margin-top:8px">${total}</span>`;
  document.getElementById('modal-excluir-venda').classList.add('open');
}

async function excluirVenda(){
  const id = parseInt(document.getElementById('excluir-venda-id').value);
  try {
    await dbDelete('vendas', id);
    vendas = vendas.filter(v=>v.id!==id);
    await registrarAudit('EXCLUIR_VENDA', `Venda #${String(id).padStart(3,'0')} excluída`);
    document.getElementById('modal-excluir-venda').classList.remove('open');
    await renderVendas();
    showToast('Venda #'+String(id).padStart(3,'0')+' excluída.', false);
  } catch(e) {
    showToast('Erro ao excluir: '+e.message,'red');
  }
}

// =====================================================
// PAINEL ADMIN
// =====================================================
function abrirLoginAdmin() {
  document.getElementById('admin-user').value='';
  document.getElementById('admin-pass').value='';
  document.getElementById('admin-login-err').classList.remove('show');
  document.getElementById('modal-login-admin').classList.add('open');
  setTimeout(()=>document.getElementById('admin-user').focus(),80);
}
function fecharLoginAdmin() {
  document.getElementById('modal-login-admin').classList.remove('open');
}
async function loginAdmin() {
  const u = document.getElementById('admin-user').value.trim().toLowerCase();
  const p = document.getElementById('admin-pass').value;
  const err = document.getElementById('admin-login-err');
  if(!dbPronto){ err.textContent='Sistema iniciando...'; err.classList.add('show'); return; }
  try {
    const reg = await dbGet('usuarios', u);
    let senhaAdminOk = false;
    if (reg && reg.admin === true) {
      if (reg.salt) {
        const hash = await hashSenha(p, reg.salt);
        senhaAdminOk = hash === reg.senha;
      } else {
        senhaAdminOk = reg.senha === p;
        if (senhaAdminOk) {
          const salt = gerarSalt();
          reg.senha = await hashSenha(p, salt);
          reg.salt = salt;
          await dbPut('usuarios', reg);
        }
      }
    }
    if (senhaAdminOk) {
      adminLogado=u; err.classList.remove('show');
      fecharLoginAdmin();
      document.getElementById('tela-login').classList.add('hidden');
      document.getElementById('admin-logged-user').textContent='👤 '+u;
      document.getElementById('painel-admin').classList.add('open');
      const fm=document.getElementById('filtro-mes');
      if(!fm.value) fm.value=hoje().slice(0,7);
      adminNavTo('relatorios');
    } else {
      err.textContent=reg?'Usuário sem permissão de administrador.':'Usuário ou senha incorretos.';
      err.classList.add('show');
      document.getElementById('admin-pass').value='';
    }
  } catch(e){ handleError(e, 'Erro ao verificar', err); }
}
function fecharAdmin() {
  document.getElementById('painel-admin').classList.remove('open');
  document.getElementById('tela-login').classList.remove('hidden');
  adminLogado=null;
}
function adminNavTo(page) {
  document.querySelectorAll('.admin-page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.admin-nav').forEach(b=>b.classList.remove('active'));
  document.getElementById('apage-'+page).classList.add('active');
  document.getElementById('anav-'+page).classList.add('active');
  if(page==='relatorios')  renderRelatorios();
  if(page==='auditoria')   renderAuditoria();
  if(page==='usuarios')   renderUsuariosAdmin();
  if(page==='dados')       _resetImportUI();
}

// =====================================================
// EXPORTAR / IMPORTAR DADOS
// =====================================================
async function exportarDados(tipo) {
  try {
    let data = {};
    const ts = new Date().toISOString().slice(0,10);
    let filename = '';
    if (tipo === 'produtos' || tipo === 'tudo') {
      data.produtos = await dbGetAll('produtos');
    }
    if (tipo === 'vendas' || tipo === 'tudo') {
      data.vendas = await dbGetAll('vendas');
    }
    if (tipo === 'produtos') filename = `mercadinho-estoque-${ts}.json`;
    else if (tipo === 'vendas') filename = `mercadinho-vendas-${ts}.json`;
    else filename = `mercadinho-backup-${ts}.json`;

    data._exportadoEm = new Date().toISOString();
    data._versao = '1.0';

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast(`Arquivo "${filename}" exportado!`, true);
    await registrarAudit('EXPORTAR', `Exportação de ${tipo}`);
  } catch(e) {
    showToast('Erro ao exportar: ' + (e?.message || String(e)), 'red');
  }
}

function _resetImportUI() {
  const fi = document.getElementById('import-file');
  const fn = document.getElementById('import-filename');
  const pv = document.getElementById('import-preview');
  if(fi) fi.value = '';
  if(fn) fn.textContent = 'Nenhum arquivo selecionado';
  if(pv) { pv.style.display = 'none'; pv.innerHTML = ''; }
  _importDadosPendentes = null;
}

let _importDadosPendentes = null;

function _initImportListeners() {
  const btn   = document.getElementById('btn-escolher-arquivo');
  const input = document.getElementById('import-file');
  if (!btn || !input) return;

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const fnEl = document.getElementById('import-filename');
    const pvEl = document.getElementById('import-preview');
    if (!input.files.length) return;
    const file = input.files[0];
    fnEl.textContent = file.name;
    pvEl.style.display = 'none';
    pvEl.innerHTML = '';
    _importDadosPendentes = null;

    const reader = new FileReader();
    reader.onerror = () => {
      pvEl.style.display = 'block';
      pvEl.innerHTML = '<span style="color:var(--red);font-weight:700">Erro ao ler o arquivo.</span>';
    };
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.produtos && !data.vendas) {
          pvEl.style.display = 'block';
          pvEl.innerHTML = '<span style="color:var(--red);font-weight:700">Arquivo inválido: nenhum dado de produtos ou vendas encontrado.</span>';
          return;
        }
        _importDadosPendentes = data;

        const nProd = (data.produtos || []).length;
        const nVend = (data.vendas   || []).length;

        // Monta preview via DOM (sem onclick em innerHTML)
        pvEl.innerHTML = '';

        const info = document.createElement('div');
        let infoHtml = `<strong>Conteúdo do arquivo:</strong><ul style="margin:8px 0 12px;padding-left:20px">`;
        if (nProd > 0) infoHtml += `<li>${nProd} produto(s) no estoque</li>`;
        if (nVend > 0) infoHtml += `<li>${nVend} venda(s)</li>`;
        if (data._exportadoEm) infoHtml += `<li>Exportado em: ${new Date(data._exportadoEm).toLocaleString('pt-BR')}</li>`;
        infoHtml += `</ul><p style="margin:0 0 12px;color:#92400e;font-weight:600;background:#fef3c7;padding:8px 12px;border-radius:8px">⚠️ Produtos com mesmo código de barras ou nome não serão duplicados.</p>`;
        info.innerHTML = infoHtml;
        pvEl.appendChild(info);

        const btnOk = document.createElement('button');
        btnOk.textContent = '✔ Confirmar Importação';
        btnOk.style.cssText = 'padding:9px 22px;background:#16a34a;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer';
        btnOk.addEventListener('click', confirmarImport);

        const btnNo = document.createElement('button');
        btnNo.textContent = 'Cancelar';
        btnNo.style.cssText = 'margin-left:10px;padding:9px 18px;background:none;border:1.5px solid #cbd5e1;border-radius:10px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer';
        btnNo.addEventListener('click', _resetImportUI);

        pvEl.appendChild(btnOk);
        pvEl.appendChild(btnNo);
        pvEl.style.display = 'block';
      } catch(err) {
        pvEl.style.display = 'block';
        pvEl.innerHTML = '<span style="color:var(--red);font-weight:700">Erro ao ler arquivo. Certifique-se de que é um JSON válido exportado pelo Mercadinho.</span>';
      }
    };
    reader.readAsText(file, 'UTF-8');
  });
}

async function confirmarImport() {
  if (!_importDadosPendentes) return;
  const data = _importDadosPendentes;
  const pvEl = document.getElementById('import-preview');
  pvEl.innerHTML = '<em style="color:var(--muted)">Importando...</em>';

  let addedProd = 0, skippedProd = 0, addedVend = 0;

  try {
    if (data.produtos && data.produtos.length > 0) {
      const existentes = await dbGetAll('produtos');
      for (const p of data.produtos) {
        try {
          const dup = existentes.find(e => {
            if (p.barras && e.barras) return p.barras === e.barras;
            const nP = (p.nome || '').toLowerCase().trim();
            const nE = (e.nome || '').toLowerCase().trim();
            return nP !== '' && nP === nE;
          });
          if (dup) { skippedProd++; continue; }
          const { id: _id, ...sem } = p;
          await dbAdd('produtos', sem);
          existentes.push(sem);
          addedProd++;
        } catch(_) { skippedProd++; }
      }
    }

    if (data.vendas && data.vendas.length > 0) {
      for (const v of data.vendas) {
        try {
          const { id: _id, ...sem } = v;
          await dbAdd('vendas', sem);
          addedVend++;
        } catch(_) {}
      }
    }

    // Recarrega memória
    produtos = await dbGetAll('produtos');
    produtos.sort((a,b)=>a.nome.localeCompare(b.nome));
    vendas = await dbGetAll('vendas');
    vendas.sort((a,b)=>b.id-a.id);

    await registrarAudit('IMPORTAR', `+${addedProd} produtos, +${addedVend} vendas (${skippedProd} ignorados por duplicata)`);
    showToast(`Importado: ${addedProd} produto(s), ${addedVend} venda(s). ${skippedProd > 0 ? skippedProd + ' ignorado(s).' : ''}`, true);
    _resetImportUI();
  } catch(e) {
    pvEl.innerHTML = '<span style="color:var(--red);font-weight:700">Erro na importação: ' + (e?.message || String(e)) + '</span>';
  }
}
async function renderRelatorios() {
  const mes=document.getElementById('filtro-mes').value;
  const todas=await dbGetAll('sessoes');
  const lista=mes?todas.filter(s=>s.data&&s.data.startsWith(mes)):todas;
  lista.sort((a,b)=>b.id-a.id);
  const tbody=document.getElementById('admin-relatorios-tbody');
  tbody.innerHTML='';
  lista.forEach(s=>{
    const tr=document.createElement('tr');
    const badge=s.status==='aberta'
      ?'<span class="sessao-badge sessao-aberta">Aberta</span>'
      :'<span class="sessao-badge sessao-fechada">Fechada</span>';
    tr.innerHTML=`
      <td style="color:var(--muted);font-size:12px">#${String(s.id).padStart(3,'0')}</td>
      <td>${s.data||'—'}</td>
      <td><strong>${s.operador||'—'}</strong></td>
      <td>${s.abertoHora||'—'}</td>
      <td>${s.fechadoHora||'—'}</td>
      <td>${s.duracao||'—'}</td>
      <td style="text-align:center">${s.numVendas||0}</td>
      <td style="color:var(--green);font-weight:800">${fmt(s.totalVendas||0)}</td>
      <td>${badge}</td>`;
    tbody.appendChild(tr);
  });
  if(lista.length===0)
    tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:28px">Nenhuma sessão encontrada.</td></tr>';
  const tot=lista.reduce((s,v)=>s+(v.totalVendas||0),0);
  document.getElementById('ar-total').textContent=fmt(tot);
  document.getElementById('ar-sessoes').textContent=lista.length;
  document.getElementById('ar-media').textContent=lista.length?fmt(tot/lista.length):'R$ 0,00';
}
async function renderUsuariosAdmin() {
  const lista=await dbGetAll('usuarios');
  const tbody=document.getElementById('admin-usuarios-tbody');
  tbody.innerHTML='';
  lista.forEach(u=>{
    const tr=document.createElement('tr');
    const perfil=u.admin
      ?'<span style="background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">Administrador</span>'
      :'<span style="background:var(--bg);color:var(--muted);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">Operador</span>';
    tr.innerHTML=`
      <td><strong>${u.usuario}</strong></td>
      <td>${u.nome||'—'}</td>
      <td>${perfil}</td>
      <td style="color:var(--muted);font-size:12px">${u.criadoEm?new Date(u.criadoEm).toLocaleDateString('pt-BR'):'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn-edit" onclick="editarUsuario('${u.usuario}')">✏️</button>
        <button class="btn-del"  onclick="deletarUsuario('${u.usuario}')">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  if(lista.length===0)
    tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">Nenhum usuário.</td></tr>';
}
function abrirModalNovoUsuario() {
  editandoUsuario=null;
  document.getElementById('modal-usuario-titulo').textContent='Novo Usuário';
  ['u-login','u-nome','u-senha'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('u-perfil').value='operador';
  document.getElementById('u-login').disabled=false;
  document.getElementById('usuario-err').classList.remove('show');
  document.getElementById('modal-usuario').classList.add('open');
  setTimeout(()=>document.getElementById('u-login').focus(),80);
}
async function editarUsuario(login) {
  const u=await dbGet('usuarios',login); if(!u) return;
  editandoUsuario=login;
  document.getElementById('modal-usuario-titulo').textContent='Editar Usuário';
  document.getElementById('u-login').value=u.usuario;
  document.getElementById('u-login').disabled=true;
  document.getElementById('u-nome').value=u.nome||'';
  document.getElementById('u-senha').value='';
  document.getElementById('u-perfil').value=u.admin?'admin':'operador';
  document.getElementById('usuario-err').classList.remove('show');
  document.getElementById('modal-usuario').classList.add('open');
}
// =====================================================
// AUDITORIA — RENDERIZAÇÃO (6.2)
// =====================================================
const AUDIT_BADGES = {
  LOGIN:           ['#dbeafe','#1d4ed8','Login'],
  LOGOUT:          ['#f1f5f9','#475569','Logout'],
  ABRIR_CAIXA:     ['#dcfce7','#15803d','Abrir Caixa'],
  FECHAR_CAIXA:    ['#fef9c3','#92400e','Fechar Caixa'],
  VENDA:           ['#dcfce7','#15803d','Venda'],
  EXCLUIR_VENDA:   ['#fee2e2','#b91c1c','Excluir Venda'],
  CRIAR_PRODUTO:   ['#dcfce7','#15803d','Novo Produto'],
  EDITAR_PRODUTO:  ['#fef9c3','#92400e','Editar Produto'],
  EXCLUIR_PRODUTO: ['#fee2e2','#b91c1c','Excluir Produto'],
  CRIAR_USUARIO:   ['#ede9fe','#6d28d9','Novo Usuário'],
  EDITAR_USUARIO:  ['#fef9c3','#92400e','Editar Usuário'],
  EXCLUIR_USUARIO: ['#fee2e2','#b91c1c','Excluir Usuário'],
};

async function renderAuditoria() {
  const filData = document.getElementById('audit-filtro-data')?.value || '';
  const filUser = (document.getElementById('audit-filtro-user')?.value || '').toLowerCase().trim();
  let lista;
  if (filData) {
    lista = await dbByIdx('auditoria', 'data', filData);
  } else {
    lista = await dbGetAll('auditoria');
  }
  if (filUser) lista = lista.filter(r => r.usuario.toLowerCase().includes(filUser));
  lista.sort((a,b) => b.id - a.id);

  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = '';
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">Nenhum registro encontrado.</td></tr>';
    return;
  }
  const frag = document.createDocumentFragment();
  lista.forEach(r => {
    const [bg, color, label] = AUDIT_BADGES[r.acao] || ['#f1f5f9','#475569', r.acao];
    const badge = `<span style="background:${bg};color:${color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${label}</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--muted);font-size:12px">${r.data} ${r.hora}</td>
      <td><strong>${r.usuario}</strong></td>
      <td>${badge}</td>
      <td style="font-size:12px;color:var(--muted)">${r.detalhe}</td>`;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  document.getElementById('audit-total').textContent = lista.length + ' registro' + (lista.length !== 1 ? 's' : '');
}

function fecharModalUsuario() { document.getElementById('modal-usuario').classList.remove('open'); }
async function salvarUsuario() {
  const login=document.getElementById('u-login').value.trim().toLowerCase();
  const nome=document.getElementById('u-nome').value.trim();
  const senha=document.getElementById('u-senha').value;
  const admin=document.getElementById('u-perfil').value==='admin';
  const err=document.getElementById('usuario-err');
  if(!login){ err.textContent='Informe o login.'; err.classList.add('show'); return; }
  if(!editandoUsuario&&!senha){ err.textContent='Informe a senha.'; err.classList.add('show'); return; }
  try {
    if(editandoUsuario) {
      const u=await dbGet('usuarios',editandoUsuario);
      u.nome=nome; u.admin=admin;
      if(senha) {
        u.salt = gerarSalt();
        u.senha = await hashSenha(senha, u.salt);
      }
      await dbPut('usuarios',u);
      await registrarAudit('EDITAR_USUARIO', `Usuário "${login}" editado por "${adminLogado}"`);
      fecharModalUsuario();
      renderUsuariosAdmin();
      document.getElementById('sucesso-usuario-titulo').textContent='Usuário Atualizado!';
      document.getElementById('sucesso-usuario-msg').textContent=
        'Os dados do usuário "'+login+'" foram atualizados com sucesso.';
      document.getElementById('modal-sucesso-usuario').classList.add('open');
    } else {
      const existe=await dbGet('usuarios',login);
      if(existe){ err.textContent='Login já existe.'; err.classList.add('show'); return; }
      const salt = gerarSalt();
      const senhaHash = await hashSenha(senha, salt);
      await dbPut('usuarios',{usuario:login,nome,senha:senhaHash,salt,admin,criadoEm:new Date().toISOString()});
      await registrarAudit('CRIAR_USUARIO', `Usuário "${login}" criado por "${adminLogado}" — perfil: ${admin?'Admin':'Operador'}`);
      fecharModalUsuario();
      renderUsuariosAdmin();
      const perfil = admin ? 'Administrador' : 'Operador de Caixa';
      document.getElementById('sucesso-usuario-titulo').textContent='Usuário Cadastrado!';
      document.getElementById('sucesso-usuario-msg').textContent=
        'Login: '+login+(nome?' · Nome: '+nome:'')+' · Perfil: '+perfil;
      document.getElementById('modal-sucesso-usuario').classList.add('open');
    }
  } catch(e){ err.textContent='Erro: '+e.message; err.classList.add('show'); }
}
function deletarUsuario(login) {
  if(login===adminLogado){ showToast('Não pode excluir o usuário logado.','red'); return; }
  mostrarConfirmar('Excluir usuário', `Excluir o usuário "${login}"? Esta ação não pode ser desfeita.`, async () => {
    await dbDelete('usuarios', login);
    await registrarAudit('EXCLUIR_USUARIO', `Usuário "${login}" excluído por "${adminLogado}"`);
    renderUsuariosAdmin();
    showToast('Usuário removido.');
  });
}

// =====================================================
// FECHAR PROGRAMA
// =====================================================
function fecharPrograma() {
  document.getElementById('modal-fechar-programa').classList.add('open');
}

async function confirmarFecharPrograma() {
  try { await dbPut('caixa',{chave:'estado',aberto:true,abertoEm:openSince?.toISOString(),trocoInicial}); } catch(e){}
  window.close();
  // Fallback: se window.close() não funcionar (browser)
  setTimeout(()=>{
    document.getElementById('modal-fechar-programa').classList.remove('open');
    showToast('Pressione Alt+F4 ou feche pela barra de título para sair.','red');
  }, 400);
}

// =====================================================
// TOAST (5.5 — durações por tipo + botão X)
// =====================================================
function showToast(msg, tipo=false) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${msg}</span><button class="toast-close" onclick="fecharToast()">✕</button>`;
  t.className = 'toast show' + (tipo===true?' green':tipo==='red'?' red':'');
  clearTimeout(toastTimer);
  const duration = tipo === 'red' ? 5000 : 3000;
  toastTimer = setTimeout(() => t.className = 'toast', duration);
}
function fecharToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').className = 'toast';
}

// =====================================================
// MODAL CONFIRMAÇÃO CUSTOMIZADO (5.7)
// =====================================================
let _confirmarCallback = null;
function mostrarConfirmar(titulo, msg, callback) {
  document.getElementById('confirmar-titulo').textContent = titulo;
  document.getElementById('confirmar-msg').textContent   = msg;
  _confirmarCallback = callback;
  document.getElementById('modal-confirmar').classList.add('open');
  setTimeout(() => document.getElementById('confirmar-btn-ok').focus(), 80);
}
function fecharConfirmar() {
  document.getElementById('modal-confirmar').classList.remove('open');
  _confirmarCallback = null;
}
function confirmarAcao() {
  document.getElementById('modal-confirmar').classList.remove('open');
  if (_confirmarCallback) _confirmarCallback();
  _confirmarCallback = null;
}

// =====================================================
// TIMEOUT DE SESSÃO (5.3 — 30 min de inatividade)
// =====================================================
const TIMEOUT_SESSAO = 30 * 60 * 1000;
const AVISO_TIMEOUT  =  2 * 60 * 1000;
let timerSessao = null, timerAviso = null;

function resetarTimeoutSessao() {
  if (!usuarioLogado) return;
  clearTimeout(timerSessao);
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => {
    showToast('Sessão expira em 2 minutos por inatividade.', 'red');
  }, TIMEOUT_SESSAO - AVISO_TIMEOUT);
  timerSessao = setTimeout(() => {
    logout();
    showToast('Sessão encerrada por inatividade.', 'red');
  }, TIMEOUT_SESSAO);
}

function iniciarTimeoutSessao() {
  resetarTimeoutSessao();
  ['click','keydown','mousemove','touchstart'].forEach(ev =>
    document.addEventListener(ev, resetarTimeoutSessao, { passive: true })
  );
}

function pararTimeoutSessao() {
  clearTimeout(timerSessao);
  clearTimeout(timerAviso);
  timerSessao = null; timerAviso = null;
}

// =====================================================
// BOOT
// =====================================================
function mostrarPrimeiroAcesso() {
  document.getElementById('tela-login').classList.add('hidden');
  document.getElementById('tela-primeiro-acesso').classList.remove('hidden');
  setTimeout(()=>document.getElementById('setup-nome').focus(), 100);
}

async function salvarPrimeiroAdmin() {
  const nome    = document.getElementById('setup-nome').value.trim();
  const login   = document.getElementById('setup-login').value.trim().toLowerCase();
  const senha   = document.getElementById('setup-senha').value;
  const confirma= document.getElementById('setup-confirma').value;
  const err     = document.getElementById('setup-err');

  if (!nome)                   { err.textContent='Informe seu nome.';              err.classList.add('show'); return; }
  if (!login)                  { err.textContent='Informe o login.';               err.classList.add('show'); return; }
  if (senha.length < 4)        { err.textContent='Senha deve ter ao menos 4 caracteres.'; err.classList.add('show'); return; }
  if (senha !== confirma)      { err.textContent='As senhas não coincidem.';        err.classList.add('show'); return; }

  try {
    const salt = gerarSalt();
    const senhaHash = await hashSenha(senha, salt);
    await dbPut('usuarios', { usuario:login, nome, senha:senhaHash, salt, admin:true, criadoEm:new Date().toISOString() });

    // Carrega produtos e vendas antes de liberar o login
    produtos = await dbGetAll('produtos');
    if (produtos.length === 0) {
      for (const p of SEED) await dbAdd('produtos', p);
      produtos = await dbGetAll('produtos');
    }
    vendas = await dbByIdx('vendas','data',hoje());
    vendas.sort((a,b)=>b.id-a.id);
    dbPronto = true;

    document.getElementById('tela-primeiro-acesso').classList.add('hidden');
    document.getElementById('tela-login').classList.remove('hidden');
    document.getElementById('login-user').value = login;
    document.getElementById('login-pass').focus();
    showToast('Conta criada! Faça login para continuar.', true);
  } catch(e) {
    err.textContent = 'Erro ao criar conta: ' + e.message;
    err.classList.add('show');
  }
}

async function boot(){
  try {
    await initDB();
    const todosUsuarios = await dbGetAll('usuarios');
    if (todosUsuarios.length === 0) {
      mostrarPrimeiroAcesso();
      return;
    }
    produtos = await dbGetAll('produtos');
    if(produtos.length===0){
      for(const p of SEED) await dbAdd('produtos',p);
      produtos = await dbGetAll('produtos');
    }
    vendas = await dbByIdx('vendas','data',hoje());
    vendas.sort((a,b)=>b.id-a.id);
    dbPronto = true;
  } catch(e) {
    console.error('Erro no boot:',e);
    showToast('Erro ao iniciar banco: '+e.message,'red');
  }
}

// 2.2 — Proteção contra múltiplas abas/janelas
const _bc = new BroadcastChannel('mercadinho_instancia');
_bc.onmessage = (e) => {
  if (e.data === 'ping') {
    _bc.postMessage('pong');
  } else if (e.data === 'pong') {
    showToast('Atenção: o sistema já está aberto em outra janela! Dados podem ficar inconsistentes.', 'red');
  }
};
_bc.postMessage('ping');

boot();
_initImportListeners();

// Fechar modal clicando fora
// Fechar modal clicando fora
[
  ['modal-fechamento',    null],
  ['modal-venda',         null],
  ['modal-excluir-venda', null],
  ['modal-fechar-programa', null],
  ['modal-recovery',      null],
  ['modal-confirmar',     'fecharConfirmar'],
  ['modal-sucesso',       'fecharSucesso'],
  ['modal-duplicado',     null],
  ['modal-avulso',        'fecharAvulso'],
].forEach(([id, fn]) => {
  document.getElementById(id)?.addEventListener('click', function(e) {
    if (e.target !== this) return;
    if (fn) window[fn]();
    else this.classList.remove('open');
  });
});

// 5.4 — Atalhos de teclado
document.addEventListener('keydown', e => {
  // Fechar qualquer modal aberto com Esc
  if (e.key === 'Escape') {
    const abertos = document.querySelectorAll('.modal-overlay.open, .admin-modal-overlay.open');
    abertos.forEach(m => m.classList.remove('open'));
    if (_confirmarCallback) fecharConfirmar();
    return;
  }
  // F1–F4 navegam entre abas (apenas quando o app está visível)
  if (!usuarioLogado) return;
  const mapa = { F1:'caixa', F2:'estoque', F3:'vendas' };
  if (mapa[e.key]) { e.preventDefault(); navTo(mapa[e.key]); }
});

// 5.2 — Validação em tempo real no formulário de produto
document.getElementById('m-nome')?.addEventListener('input', function() {
  this.style.borderColor = this.value.trim() ? '' : 'var(--red)';
});
document.getElementById('m-preco-venda')?.addEventListener('input', function() {
  const v = parseFloat(this.value.replace(',','.'));
  this.style.borderColor = (!isNaN(v) && v > 0) ? '' : 'var(--red)';
});
document.getElementById('m-estoque')?.addEventListener('input', function() {
  const v = parseInt(this.value);
  this.style.borderColor = (!isNaN(v) && v >= 0) ? '' : 'var(--red)';
});