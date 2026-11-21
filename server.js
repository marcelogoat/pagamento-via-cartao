const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'rastreios.json');
const BACKUP_FILE = path.join(__dirname, 'data', 'rastreios.backup.json');
const TEMP_FILE = path.join(__dirname, 'data', 'rastreios.tmp');
const LINKS_FILE = path.join(__dirname, 'data', 'links.json');
const PEDIDOS_FILE = path.join(__dirname, 'data', 'pedidos.json');
const CAMPOS_GLOBAIS_FILE = path.join(__dirname, 'data', 'campos_globais.json');

function carregarCamposGlobais() {
  try {
    if (!fs.existsSync(CAMPOS_GLOBAIS_FILE)) return [];
    const raw = fs.readFileSync(CAMPOS_GLOBAIS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch(e) { return []; }
}

function salvarCamposGlobais(lista) {
  try {
    fs.writeFileSync(CAMPOS_GLOBAIS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
    return true;
  } catch(e) { return false; }
}

function carregarLinksLocais() {
  try {
    if (!fs.existsSync(LINKS_FILE)) return [];
    const raw = fs.readFileSync(LINKS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch(e) { return []; }
}

function salvarLinksLocais(lista) {
  try {
    fs.writeFileSync(LINKS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
    return true;
  } catch(e) { return false; }
}

function carregarPedidosLocais() {
  try {
    if (!fs.existsSync(PEDIDOS_FILE)) return [];
    const raw = fs.readFileSync(PEDIDOS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch(e) { return []; }
}

function salvarPedidosLocais(lista) {
  try {
    fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
    return true;
  } catch(e) { return false; }
}

// Suporte a Nuvem (Detecta automaticamente Upstash, KV ou STORAGE da Vercel)
function getEnvVal(suffix) {
  for (const k of Object.keys(process.env)) {
    if (k.endsWith(suffix) && process.env[k]) return process.env[k];
  }
  return '';
}

const KV_URL = process.env.STORAGE_REST_API_URL || 
               process.env.UPSTASH_REDIS_REST_URL || 
               process.env.KV_REST_API_URL || 
               getEnvVal('_REST_API_URL') || '';

const KV_TOKEN = process.env.STORAGE_REST_API_TOKEN || 
                 process.env.UPSTASH_REDIS_REST_TOKEN || 
                 process.env.KV_REST_API_TOKEN || 
                 getEnvVal('_REST_API_TOKEN') || '';

// Credenciais do Painel Admin
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'pizza2024';
const AUTH_SECRET = 'secret_salt_rastreio_2026';

function gerarTokenAuth() {
  return crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}:${AUTH_SECRET}`).digest('hex');
}
const VALID_TOKEN = gerarTokenAuth();

function validarToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7).trim();
  return token === VALID_TOKEN;
}

// Garantir que a pasta data e o arquivo existam (try/catch para Vercel read-only filesystem)
try {
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
} catch (err) {
  // Em ambiente serverless (Vercel), o filesystem é read-only — dados vão para Redis/KV
}

function carregarDadosLocais() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        const rawBackup = fs.readFileSync(BACKUP_FILE, 'utf-8');
        return JSON.parse(rawBackup);
      } catch (bErr) {}
    }
    return [];
  }
}

// Carrega rastreios (Nuvem Upstash Redis ou Disco Local)
async function carregarRastreios() {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/rastreios_db`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const data = await res.json();
      if (data && data.result !== null && data.result !== undefined) {
        const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        if (Array.isArray(parsed)) return parsed;
      }
      
      // Se a chave ainda não existe no Redis (primeiro acesso na nuvem), semeia com os dados iniciais
      const dadosIniciais = carregarDadosLocais();
      if (dadosIniciais.length > 0) {
        salvarRastreios(dadosIniciais).catch(() => {});
      }
      return dadosIniciais;
    } catch (err) {
      console.error('Erro ao ler KV em nuvem:', err.message);
    }
  }

  return carregarDadosLocais();
}

// Salva rastreios (Nuvem ou Disco Local com Escrita Atômica + Backup)
async function salvarRastreios(lista) {
  let salvoNuvem = false;

  if (KV_URL && KV_TOKEN) {
    try {
      const payloadStr = JSON.stringify(lista);
      const res = await fetch(`${KV_URL}/set/rastreios_db`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'text/plain'
        },
        body: payloadStr
      });
      const resData = await res.json();
      if (resData && (resData.result === 'OK' || !resData.error)) {
        salvoNuvem = true;
      }
    } catch (err) {
      console.error('Erro ao salvar no KV em nuvem:', err.message);
    }
  }

  try {
    const jsonStr = JSON.stringify(lista, null, 2);
    fs.writeFileSync(TEMP_FILE, jsonStr, 'utf-8');
    if (fs.existsSync(DATA_FILE)) {
      try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch (e) {}
    }
    fs.renameSync(TEMP_FILE, DATA_FILE);
    return true;
  } catch (err) {
    // Em ambiente serverless (Vercel), fs falha porque é read-only
    // Mas se salvou na nuvem, é sucesso absoluto!
    if (salvoNuvem) return true;
    console.error('Erro ao salvar localmente:', err.message);
    return false;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function formatDataRelativa(horasAtras) {
  const d = new Date(Date.now() - horasAtras * 3600000);
  const hoje = new Date();
  const diaD = d.getDate();
  const mesD = String(d.getMonth() + 1).padStart(2, '0');
  const anoD = d.getFullYear();
  const horaStr = String(d.getHours()).padStart(2, '0');
  const minStr = String(d.getMinutes()).padStart(2, '0');

  const diffDias = Math.floor((hoje.setHours(0,0,0,0) - new Date(d).setHours(0,0,0,0)) / 86400000);
  if (diffDias === 0) {
    return `Hoje às ${horaStr}:${minStr}`;
  } else if (diffDias === 1) {
    return `Ontem às ${horaStr}:${minStr}`;
  } else {
    return `${String(diaD).padStart(2, '0')}/${mesD}/${anoD} às ${horaStr}:${minStr}`;
  }
}

function formatNowBR() {
  return formatDataRelativa(0);
}

function gerarEventosIniciais(status, origem, destino, frete) {
  const orig = origem || 'São Paulo / SP';
  const dest = destino || 'Curitiba / PR';
  const transportadora = frete || 'SEDEX Express';

  const sNorm = (status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // 1. Preparação / Pagamento Aprovado
  const evFaturado = {
    titulo: 'Pagamento confirmado e pedido aprovado',
    data: formatDataRelativa(1.5),
    descricao: `Pagamento confirmado e etiqueta de envio ${transportadora} gerada para despacho`,
    local: `Centro de Logística e Distribuição (${orig})`,
    tipo: 'faturado'
  };

  // 2. Postagem
  const evPostado = {
    titulo: 'Objeto postado',
    data: formatNowBR(),
    descricao: `Objeto postado na agência dos Correios / Centro Operacional ${transportadora}`,
    local: `Agência dos Correios (${orig})`,
    tipo: 'postado'
  };

  // 3. Intermediário: Agência Origem ➔ Centro de Tratamento Origem
  const evRecebidoCTE_Origem = {
    titulo: 'Objeto recebido na Unidade de Tratamento',
    data: formatDataRelativa(2),
    descricao: `Objeto conferido e integrado para processamento de triagem e despacho interestadual`,
    local: `Centro de Logística e Tratamento (${orig})`,
    tipo: 'recebido'
  };

  // 4. Intermediário: Centro Tratamento Origem ➔ Centro Tratamento Destino
  const evTransitoOrigemDestino = {
    titulo: 'Objeto em trânsito - por favor aguarde',
    data: formatNowBR(),
    descricao: `De Centro de Logística e Tratamento em ${orig} para Unidade de Tratamento e Logística em ${dest}`,
    local: `Centro de Logística em ${orig}`,
    tipo: 'transito'
  };

  // 5. Intermediário: Chegada no Centro de Tratamento de Destino
  const evRecebidoCTE_Destino = {
    titulo: 'Objeto recebido pelos Correios do Brasil',
    data: formatDataRelativa(3),
    descricao: `Objeto recebido na Unidade de Tratamento e Logística Regional para triagem e encaminhamento local`,
    local: `Unidade de Tratamento em ${dest}`,
    tipo: 'recebido'
  };

  // 6. Intermediário: Centro Tratamento Destino ➔ Centro de Distribuição Domiciliária (CDD)
  const evTransitoCDD = {
    titulo: 'Objeto em trânsito - por favor aguarde',
    data: formatNowBR(),
    descricao: `De Unidade de Tratamento em ${dest} para Unidade de Distribuição Local (CDD)`,
    local: `Unidade de Tratamento em ${dest}`,
    tipo: 'transito'
  };

  // 7. Saída para Entrega ao Destinatário
  const evSaiuEntrega = {
    titulo: 'Objeto saiu para entrega ao destinatário',
    data: formatNowBR(),
    descricao: `Carteiro/Entregador em rota para entrega no endereço do destinatário em ${dest}`,
    local: `Unidade de Distribuição (${dest})`,
    tipo: 'entrega'
  };

  // 8. Entregue
  const evEntregue = {
    titulo: 'Objeto entregue ao destinatário',
    data: formatNowBR(),
    descricao: `Objeto entregue com sucesso para o destinatário`,
    local: dest,
    tipo: 'entregue'
  };

  if (sNorm.includes('pagamento') || sNorm.includes('faturado')) {
    evFaturado.data = formatNowBR();
    return [evFaturado];
  } else if (sNorm.includes('postado')) {
    evPostado.data = formatNowBR();
    evFaturado.data = formatDataRelativa(1.5);
    return [evPostado, evFaturado];
  } else if (sNorm.includes('entregue')) {
    evEntregue.data = formatNowBR();
    evSaiuEntrega.data = formatDataRelativa(2);
    evTransitoCDD.data = formatDataRelativa(5);
    evRecebidoCTE_Destino.data = formatDataRelativa(18);
    evTransitoOrigemDestino.data = formatDataRelativa(26);
    evRecebidoCTE_Origem.data = formatDataRelativa(30);
    evPostado.data = formatDataRelativa(32);
    evFaturado.data = formatDataRelativa(34);
    return [evEntregue, evSaiuEntrega, evTransitoCDD, evRecebidoCTE_Destino, evTransitoOrigemDestino, evRecebidoCTE_Origem, evPostado, evFaturado];
  } else if (sNorm.includes('saiu') || (sNorm.includes('entrega') && !sNorm.includes('entregue'))) {
    evSaiuEntrega.data = formatNowBR();
    evTransitoCDD.data = formatDataRelativa(2);
    evRecebidoCTE_Destino.data = formatDataRelativa(16);
    evTransitoOrigemDestino.data = formatDataRelativa(24);
    evRecebidoCTE_Origem.data = formatDataRelativa(28);
    evPostado.data = formatDataRelativa(30);
    evFaturado.data = formatDataRelativa(32);
    return [evSaiuEntrega, evTransitoCDD, evRecebidoCTE_Destino, evTransitoOrigemDestino, evRecebidoCTE_Origem, evPostado, evFaturado];
  } else if (sNorm.includes('distribui') || sNorm.includes('unidade')) {
    evTransitoCDD.data = formatNowBR();
    evRecebidoCTE_Destino.data = formatDataRelativa(4);
    evTransitoOrigemDestino.data = formatDataRelativa(18);
    evRecebidoCTE_Origem.data = formatDataRelativa(24);
    evPostado.data = formatDataRelativa(26);
    evFaturado.data = formatDataRelativa(28);
    return [evTransitoCDD, evRecebidoCTE_Destino, evTransitoOrigemDestino, evRecebidoCTE_Origem, evPostado, evFaturado];
  } else {
    // Padrão: Em trânsito recente
    evTransitoOrigemDestino.data = formatNowBR();
    evRecebidoCTE_Origem.data = formatDataRelativa(2);
    evPostado.data = formatDataRelativa(4);
    evFaturado.data = formatDataRelativa(6);
    return [evTransitoOrigemDestino, evRecebidoCTE_Origem, evPostado, evFaturado];
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const requestHandler = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  let effectiveUrl = req.url || '/';
  if (req.headers && req.headers['x-matched-path'] && req.headers['x-matched-path'].startsWith('/api')) {
    effectiveUrl = req.headers['x-matched-path'];
  } else if (req.headers && req.headers['x-forwarded-uri'] && req.headers['x-forwarded-uri'].startsWith('/api')) {
    effectiveUrl = req.headers['x-forwarded-uri'];
  } else if (effectiveUrl.includes('__url=')) {
    const match = effectiveUrl.match(/__url=([^&]+)/);
    if (match) {
      effectiveUrl = decodeURIComponent(match[1]);
    }
  }

  const [reqPath] = effectiveUrl.split('?');

  // ─── AUTENTICAÇÃO DO ADMIN ─────────────────────────────────────────────

  // POST /api/admin/login
  if (req.method === 'POST' && reqPath === '/api/admin/login') {
    try {
      const data = await parseBody(req);
      const user = (data.usuario || '').trim();
      const pass = (data.senha || '').trim();

      if (user === ADMIN_USER && (pass === 'pizza2024' || pass === 'pizza 2024')) {
        return sendJSON(res, 200, {
          success: true,
          token: VALID_TOKEN,
          usuario: ADMIN_USER
        });
      } else {
        return sendJSON(res, 401, {
          success: false,
          error: 'Usuário ou senha incorretos'
        });
      }
    } catch (err) {
      return sendJSON(res, 400, { error: 'Requisição inválida' });
    }
  }

  // GET /api/admin/check-auth
  if (req.method === 'GET' && reqPath === '/api/admin/check-auth') {
    if (validarToken(req)) {
      return sendJSON(res, 200, { authenticated: true, usuario: ADMIN_USER });
    } else {
      return sendJSON(res, 401, { authenticated: false, error: 'Não autorizado' });
    }
  }

  // ─── ROTAS DA API DE CAMPOS GLOBAIS ──────────────────────────────────────
  
  // GET /api/campos-globais (Retorna os campos padrão de todo o sistema)
  if (req.method === 'GET' && reqPath === '/api/campos-globais') {
    const campos = carregarCamposGlobais();
    return sendJSON(res, 200, campos);
  }

  // POST /api/campos-globais (Salva os campos gerais de todo o sistema)
  if (req.method === 'POST' && reqPath === '/api/campos-globais') {
    try {
      const data = await parseBody(req);
      const campos = Array.isArray(data.campos) ? data.campos : (Array.isArray(data) ? data : []);
      salvarCamposGlobais(campos);

      // Se solicitado, replica os campos globais para todos os links cadastrados
      if (data.atualizarTodosLinks || data.replicarParaTodos) {
        const links = carregarLinksLocais();
        links.forEach(l => {
          l.campos = campos;
          l.atualizadoEm = new Date().toISOString();
        });
        salvarLinksLocais(links);
      }

      return sendJSON(res, 200, { success: true, message: 'Campos globais salvos com sucesso!', campos });
    } catch(err) {
      return sendJSON(res, 400, { error: 'Erro ao salvar campos globais: ' + err.message });
    }
  }

  // ─── ROTAS DA API DE LINKS DE PAGAMENTO ──────────────────────────────────
  
  // GET /api/links (Lista todos os links)
  if (req.method === 'GET' && reqPath === '/api/links') {
    const links = carregarLinksLocais();
    return sendJSON(res, 200, links);
  }

  // GET /api/links/:slug (Busca link por slug ou id)
  if (req.method === 'GET' && reqPath.startsWith('/api/links/')) {
    const slug = decodeURIComponent(reqPath.replace('/api/links/', '')).trim().toLowerCase();
    const links = carregarLinksLocais();
    const link = links.find(l => (l.slug && l.slug.toLowerCase() === slug) || (l.id && l.id.toLowerCase() === slug));
    if (link) {
      return sendJSON(res, 200, link);
    } else {
      return sendJSON(res, 404, { error: 'Link de pagamento não encontrado' });
    }
  }

  // POST /api/links (Cria ou atualiza link de pagamento)
  if (req.method === 'POST' && reqPath === '/api/links') {
    try {
      const data = await parseBody(req);
      const links = carregarLinksLocais();
      const id = data.id || ('link-' + Date.now());
      const slug = (data.slug || data.titulo || 'produto')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const novoLink = {
        id,
        slug: slug || ('link-' + Date.now()),
        titulo: (data.titulo || 'Produto Sem Título').trim(),
        preco: Number(data.preco) || 0,
        frete: (data.frete || 'Frete Grátis com Seguro').trim(),
        imagem: (data.imagem || '').trim(),
        heroTitulo: (data.heroTitulo || 'Receba Primeiro, Pague Depois').trim(),
        heroSubtitulo: (data.heroSubtitulo || 'Preencha seus dados de entrega. Nós enviamos o pedido e você só paga na porta da sua casa diretamente ao entregador!').trim(),
        btnTexto: (data.btnTexto || 'CONFIRMAR PEDIDO E PAGAR NA ENTREGA').trim(),
        criadoEm: data.criadoEm || new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        campos: Array.isArray(data.campos) ? data.campos : []
      };

      const idx = links.findIndex(l => l.id === id);
      if (idx >= 0) {
        links[idx] = novoLink;
      } else {
        links.push(novoLink);
      }

      salvarLinksLocais(links);
      return sendJSON(res, 200, { success: true, link: novoLink });
    } catch(err) {
      return sendJSON(res, 400, { error: 'Erro ao salvar link de pagamento: ' + err.message });
    }
  }

  // DELETE /api/links/:id
  if (req.method === 'DELETE' && reqPath.startsWith('/api/links/')) {
    const id = decodeURIComponent(reqPath.replace('/api/links/', '')).trim();
    let links = carregarLinksLocais();
    const totalAntes = links.length;
    links = links.filter(l => l.id !== id && l.slug !== id);
    if (links.length < totalAntes) {
      salvarLinksLocais(links);
      return sendJSON(res, 200, { success: true, message: 'Link excluído com sucesso' });
    } else {
      return sendJSON(res, 404, { error: 'Link não encontrado' });
    }
  }

  // ─── ROTAS DA API DE PEDIDOS ───────────────────────────────────────────
  // GET /api/pedidos (Lista pedidos)
  if (req.method === 'GET' && reqPath === '/api/pedidos') {
    const pedidos = carregarPedidosLocais();
    return sendJSON(res, 200, pedidos);
  }

  // POST /api/pedidos (Salva pedido do cliente)
  if (req.method === 'POST' && reqPath === '/api/pedidos') {
    try {
      const data = await parseBody(req);
      const pedidos = carregarPedidosLocais();
      const novoPedido = {
        id: data.id || ('PED-' + Math.floor(100000 + Math.random() * 900000)),
        codigo: data.codigo || ('#COD-' + Math.floor(100000 + Math.random() * 900000)),
        linkId: data.linkId || '',
        linkSlug: data.linkSlug || '',
        produto: data.produto || '',
        valor: data.valor || '',
        dadosCliente: data.dadosCliente || {},
        criadoEm: new Date().toISOString()
      };
      pedidos.unshift(novoPedido);
      salvarPedidosLocais(pedidos);
      return sendJSON(res, 200, { success: true, pedido: novoPedido });
    } catch(err) {
      return sendJSON(res, 400, { error: 'Erro ao registrar pedido' });
    }
  }

  // DELETE /api/pedidos/:id (Exclui pedido específico)
  if (req.method === 'DELETE' && reqPath.startsWith('/api/pedidos/')) {
    const id = decodeURIComponent(reqPath.replace('/api/pedidos/', '')).trim();
    let pedidos = carregarPedidosLocais();
    const antes = pedidos.length;
    pedidos = pedidos.filter(p => p.id !== id && p.codigo !== id);
    if (pedidos.length < antes) {
      salvarPedidosLocais(pedidos);
      return sendJSON(res, 200, { success: true, message: 'Pedido excluído' });
    } else {
      return sendJSON(res, 404, { error: 'Pedido não encontrado' });
    }
  }

  // DELETE /api/pedidos (Limpa todos os pedidos)
  if (req.method === 'DELETE' && reqPath === '/api/pedidos') {
    salvarPedidosLocais([]);
    return sendJSON(res, 200, { success: true, message: 'Todos os pedidos foram apagados' });
  }

  // ─── ROTAS DA API DE RASTREIOS ──────────────────────────────────────────

  // GET /api/rastreios (Lista todos os rastreios para o painel admin)
  if (req.method === 'GET' && reqPath === '/api/rastreios') {
    if (!validarToken(req)) {
      return sendJSON(res, 401, { error: 'Acesso restrito ao administrador' });
    }
    const lista = await carregarRastreios();
    return sendJSON(res, 200, lista);
  }

  // GET /api/rastreios/:busca (Busca pública por código ou CPF para os clientes)
  if (req.method === 'GET' && reqPath.startsWith('/api/rastreios/')) {
    const buscaParam = decodeURIComponent(reqPath.replace('/api/rastreios/', '')).trim().toUpperCase();
    const buscaDigitos = buscaParam.replace(/\D/g, '');
    const lista = await carregarRastreios();

    const encontrado = lista.find(item => {
      const codIgual = item.codigo && item.codigo.toUpperCase() === buscaParam;
      const cpfIgual = item.cpf && item.cpf.replace(/\D/g, '') === buscaDigitos && buscaDigitos.length >= 8;
      return codIgual || cpfIgual;
    });

    if (encontrado) {
      return sendJSON(res, 200, encontrado);
    } else {
      return sendJSON(res, 404, { error: 'Rastreio não encontrado' });
    }
  }

  // POST /api/rastreios (Cadastra novo rastreio - REQUER AUTH)
  if (req.method === 'POST' && reqPath === '/api/rastreios') {
    if (!validarToken(req)) {
      return sendJSON(res, 401, { error: 'Acesso negado. Faça login no painel.' });
    }
    try {
      const data = await parseBody(req);
      const { cliente, cpf, produto, quantidade, frete, cidadeOrigem, cidadeDestino, status } = data;
      const origemFinal = (cidadeOrigem || 'São Paulo / SP').trim();
      const destinoFinal = (cidadeDestino || '').trim();

      if (!cliente || !destinoFinal) {
        return sendJSON(res, 400, { error: 'Campos obrigatórios: cliente e cidadeDestino' });
      }

      let codigo = (data.codigo || '').trim().toUpperCase();
      if (!codigo) {
        const rand = Math.floor(100000000 + Math.random() * 900000000);
        codigo = `BR${rand}BZ`;
      }

      const lista = await carregarRastreios();
      const statusFinal = status || 'Em Trânsito';
      const eventos = data.eventos && data.eventos.length > 0 
        ? data.eventos 
        : gerarEventosIniciais(statusFinal, origemFinal, destinoFinal, frete);

      const novo = {
        id: codigo,
        codigo,
        cliente: cliente.trim(),
        cpf: (cpf || '').trim(),
        produto: (produto || 'Lavadora de Alta Pressão Tramontina 1200W').trim(),
        quantidade: Number(quantidade) || 1,
        frete: (frete || 'SEDEX Express').trim(),
        cidadeOrigem: origemFinal,
        cidadeDestino: destinoFinal,
        status: statusFinal,
        criadoEm: new Date().toISOString(),
        eventos
      };

      lista.unshift(novo);
      await salvarRastreios(lista);

      return sendJSON(res, 201, novo);
    } catch (err) {
      console.error('Erro no POST /api/rastreios:', err);
      return sendJSON(res, 500, { error: 'Erro ao cadastrar rastreio' });
    }
  }

  // PUT /api/rastreios/:codigo (Atualiza status e adiciona evento - REQUER AUTH)
  if (req.method === 'PUT' && reqPath.startsWith('/api/rastreios/')) {
    if (!validarToken(req)) {
      return sendJSON(res, 401, { error: 'Acesso negado. Faça login no painel.' });
    }
    try {
      const codigoParam = decodeURIComponent(reqPath.replace('/api/rastreios/', '')).trim().toUpperCase();
      const data = await parseBody(req);
      const lista = await carregarRastreios();
      const idx = lista.findIndex(i => i.codigo.toUpperCase() === codigoParam);

      if (idx === -1) {
        return sendJSON(res, 404, { error: 'Rastreio não encontrado' });
      }

      const item = lista[idx];

      if (data.status) item.status = data.status;
      if (data.cliente) item.cliente = data.cliente;
      if (data.cpf) item.cpf = data.cpf;
      if (data.produto) item.produto = data.produto;
      if (data.quantidade) item.quantidade = Number(data.quantidade);
      if (data.frete) item.frete = data.frete;
      if (data.cidadeOrigem) item.cidadeOrigem = data.cidadeOrigem;
      if (data.cidadeDestino) item.cidadeDestino = data.cidadeDestino;

      if (data.novoEvento) {
        if (!item.eventos) item.eventos = [];
        
        // Mapeamento inteligente do tipo com base no status atual
        let tipoEvento = data.novoEvento.tipo;
        if (!tipoEvento || tipoEvento === 'transito') {
          const s = (item.status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          if (s.includes('entregue')) tipoEvento = 'entregue';
          else if (s.includes('saiu') || s.includes('entrega')) tipoEvento = 'entrega';
          else if (s.includes('postado')) tipoEvento = 'postado';
          else if (s.includes('pagamento') || s.includes('faturado')) tipoEvento = 'faturado';
          else if (s.includes('distribui') || s.includes('recebido') || s.includes('unidade')) tipoEvento = 'recebido';
          else tipoEvento = 'transito';
        }

        item.eventos.unshift({
          titulo: data.novoEvento.titulo || `Status atualizado para ${item.status}`,
          data: data.novoEvento.data || formatNowBR(),
          descricao: data.novoEvento.descricao || `Movimentação registrada em direção a ${item.cidadeDestino}`,
          local: data.novoEvento.local || item.cidadeDestino,
          tipo: tipoEvento
        });
      }

      lista[idx] = item;
      await salvarRastreios(lista);

      return sendJSON(res, 200, item);
    } catch (err) {
      console.error('Erro no PUT /api/rastreios:', err);
      return sendJSON(res, 500, { error: 'Erro ao atualizar rastreio' });
    }
  }

  // DELETE /api/rastreios/:codigo (Exclui rastreio - REQUER AUTH)
  if (req.method === 'DELETE' && reqPath.startsWith('/api/rastreios/')) {
    if (!validarToken(req)) {
      return sendJSON(res, 401, { error: 'Acesso negado. Faça login no painel.' });
    }
    const codigoParam = decodeURIComponent(reqPath.replace('/api/rastreios/', '')).trim().toUpperCase();
    let lista = await carregarRastreios();
    const initialLength = lista.length;

    lista = lista.filter(i => i.codigo.toUpperCase() !== codigoParam);

    if (lista.length === initialLength) {
      return sendJSON(res, 404, { error: 'Rastreio não encontrado para exclusão' });
    }

    await salvarRastreios(lista);
    return sendJSON(res, 200, { success: true, message: 'Rastreio excluído com sucesso' });
  }

  // ─── ROTAS ESTÁTICAS ────────────────────────────────────────────────────
  let localFile = 'index.html';
  if (reqPath === '/admin' || reqPath === '/admin.html') {
    localFile = 'admin.html';
  } else if (reqPath === '/dados' || reqPath === '/dados.html' || reqPath === '/pedidos' || reqPath === '/pedidos.html') {
    localFile = 'dados.html';
  } else if (reqPath.startsWith('/link/') || reqPath.startsWith('/p/')) {
    localFile = 'index.html';
  } else if (reqPath !== '/') {
    localFile = reqPath.replace(/^\/+/, '');
  }

  let filePath = path.join(__dirname, 'public', localFile);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, localFile);
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Erro interno do servidor');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    });
  });
};

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n🚀 Servidor rodando em: http://localhost:${PORT}`);
    console.log(`📦 Página de Rastreio:  http://localhost:${PORT}/`);
    console.log(`⚙️  Painel Administrativo: http://localhost:${PORT}/admin`);
    console.log(`🔐 Credenciais Admin: admin / pizza2024\n`);
  });
}

module.exports = requestHandler;
