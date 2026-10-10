#!/usr/bin/env node
// msg: CLI das sessões para a Central de Mensagens. Toda mensagem entra como "pendente";
// só sai depois que o dono aprova no painel.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { carregarConfig, dono } from '../src/config.js';

const BASE = process.env.CENTRAL_URL || 'http://127.0.0.1:4912';

// o nome do dono só existe depois do carregarConfig(), por isso a ajuda é montada na hora
const ajuda = () => `msg: manda mensagem para a Central de Mensagens. O ${dono()} edita, aprova e a Central envia.

  msg add -c whatsapp -p "DIRETORIA AURORA" -r "Otávio: perguntou do relatório" <<'EOF'
  texto da mensagem (texto puro, parágrafo em uma linha só)
  EOF

Opções do add
  -c, --canal         whatsapp | email | discord (e-mail e Discord só depois de ligados no config.json)
  -p, --para          destino: nome do grupo/contato, telefone, #canal ou e-mail(s)
      --conta         conta/caixa de envio, quando o canal tem mais de uma (e-mail: uma das contas do
                      config.json; sem isso vai pela primeira)
  -r, --responder-a   a quem/ao que responde, 1 linha ("Otávio: perguntou do relatório de ontem")
  -x, --contexto      por que a mensagem existe, 1-2 linhas (só aparece no painel)
  -s, --assunto       assunto (e-mail, obrigatório)
      --cc            cópia (e-mail)
      --cliente       de qual cliente é a mensagem (etiqueta no painel e base do aviso de cliente cruzado)
      --app           etiqueta da aplicação; sem isso sai do repo da sessão
      --em            horário sugerido: +2h, +30m, "2026-09-23 09:00" (o ${dono()} confirma)
      --substitui     número (#id) da mensagem que esta corrige: vira nova versão e a anterior que ainda não
                      saiu fica "substituida" (se já saiu, a nova avisa). Da MESMA sessão para o MESMO destino
                      não precisa: mandar de novo já substitui a anterior que não saiu
      --tambem        é outra mensagem para o mesmo destino, de propósito: não substitui a anterior
      --depois        número (#id) da mensagem que tem que sair antes desta ("manda X e depois Y": Y --depois X).
                      O ${dono()} pode aprovar as duas juntas: esta espera a anterior sair. Não substitui a anterior
      --depois-da-resposta  igual ao --depois, mas só sai depois que a pessoa responder à anterior (só WhatsApp,
                      conversa direta)
      --acompanhar [horas]  depois que sair, se a pessoa não responder em 24 h (ou nas horas pedidas: 48, 72h),
                      ela aparece na aba Acompanhar do painel (só WhatsApp; vale para grupo também)
      --anexo         arquivo (repita para vários; WhatsApp manda só o primeiro). A Central confere e guarda
                      uma cópia na criação: credencial (.env, chave, ~/.ssh), compactado, chave ou token dentro
                      do arquivo e mais de 20 MB são recusados com o motivo
  -t, --texto         texto inline, em vez de stdin
  -f, --arquivo       lê o texto de um arquivo

Outros comandos
  msg entrada [--canal X] [-n 20] [--tudo]   o que chegou e é pra você (sem --tudo esconde grupo que não
                                        te cita, "ok/obrigado" e remetente automático)
  msg acompanhar [--tudo]               quem não respondeu ao ${dono()} e as promessas (dele e para ele) que vencem
                                        em 12 h ou já venceram; --tudo mostra todas as promessas abertas
  msg contexto <canal> <destino>        o que já rolou com esse destino (evita repetir mensagem já enviada)
  msg guia                              como usar a Central: canais, destino, correção, linter, status e, no fim,
                                        as lições do ${dono()} (o que ele sempre corrige)
  msg status <id>                       saiu? deu erro? (use para confirmar antes de dizer "enviado")
  msg descartar <id> "motivo"           tira da fila uma mensagem SUA que não vale mais (o ${dono()} pode restaurar)
  msg depois <id> <anterior> [--resposta]   a <id> só sai depois da <anterior> (com --resposta, só depois que a
                                        pessoa responder a ela)
  msg depois <id> --solta               tira a ordem: a <id> sai sem esperar outra
  msg list [--status pendente] [-n 20]  status: pendente | aprovada | enviada | erro | descartada
  msg destinos <canal> "busca"          confere o nome exato de grupo, contato ou #canal
  msg ler whatsapp "grupo ou contato" [-n 30]   últimas mensagens da conversa (no lugar do print)
  msg ler discord "#canal" [-n 20]      últimas mensagens do canal
  msg ler email "consulta" [--conta X]  busca no Gmail (ou passe o id da thread)
  msg saude                             quais canais estão no ar (e o cofre e a cópia de segurança, se houver)
  msg abrir                             abre o painel (${BASE})
`;

const CURTAS = { c: 'canal', p: 'para', r: 'responder-a', x: 'contexto', s: 'assunto', t: 'texto', f: 'arquivo', n: 'n', h: 'help' };
// opção sem valor: não pode engolir o argumento seguinte ("--tudo -n 30" engolia o -n)
const SEM_VALOR = new Set(['help', 'tudo', 'tambem', 'resposta', 'solta']);
function parse(argv) {
  const pos = [];
  const op = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let chave = null;
    let valor;
    if (a.startsWith('--')) [chave, valor] = a.slice(2).split(/=(.*)/s);
    else if (/^-[a-z]$/i.test(a)) chave = CURTAS[a.slice(1)] || a.slice(1);
    else { pos.push(a); continue; }
    if (SEM_VALOR.has(chave)) { op[chave] = true; continue; }
    // --acompanhar tem horas opcionais: "--acompanhar 48" e "--acompanhar" (24 h) antes de outra opção
    if (chave === 'acompanhar' && valor === undefined) {
      op.acompanhar = /^\d+h?$/i.test(argv[i + 1] || '') ? argv[++i] : true;
      continue;
    }
    if (valor === undefined) valor = argv[++i];
    if (chave === 'anexo') (op.anexo ||= []).push(valor);
    else op[chave] = valor;
  }
  return { pos, op };
}

async function api(caminho, { metodo = 'GET', corpo } = {}) {
  let r;
  try {
    r = await fetch(BASE + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-central': '1' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    sair(`Central fora do ar em ${BASE}. Suba com "npm start" na pasta da Central (ou pelo seu gerenciador de processos)`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) sair(`Central recusou: ${j.erro || r.status}`);
  return j;
}

function sair(msg, codigo = 1) {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(codigo);
}

// As lições do dono no fim do msg guia: o que ele sempre corrige, cada uma com um exemplo. Central fora do ar não
// derruba o guia (o texto fixo já saiu).
async function licoesDoDono() {
  let lista = null;
  try {
    const r = await fetch(`${BASE}/api/licoes?ativas=1`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) lista = (await r.json()).licoes;
  } catch { /* fora do ar */ }
  const titulo = `## Lições do ${dono()}\n\n`;
  if (!Array.isArray(lista)) return `${titulo}(a Central não respondeu agora: rode msg guia de novo quando ela voltar)`;
  if (!lista.length) return `${titulo}Nenhuma lição ativa ainda.`;
  const curto = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
  const linhas = lista.map((l) => {
    const ex = l.evidencias?.[0];
    return `- ${l.texto}${ex ? `\n  ex.: #${ex.id} "${curto(ex.antes)}" → "${curto(ex.depois)}"` : ''}`;
  });
  return `${titulo}O que ele sempre corrige. O linter avisa (regra licao) quando a mensagem cai numa delas: acerte antes de mandar.\n\n${linhas.join('\n')}`;
}

// quem está enfileirando: nome da sessão do Claude Code (o título que o dono deu), pasta, repo e branch
function tituloDaSessao(id) {
  if (!id) return null;
  const base = path.join(process.env.HOME, '.claude', 'projects');
  try {
    for (const ns of fs.readdirSync(base)) {
      const arq = path.join(base, ns, `${id}.jsonl`);
      if (!fs.existsSync(arq)) continue;
      let custom = null; let ai = null;
      for (const linha of fs.readFileSync(arq, 'utf8').split('\n')) {
        if (!linha.includes('-title"')) continue;
        try {
          const j = JSON.parse(linha);
          if (j.type === 'custom-title' && j.customTitle) custom = j.customTitle;
          if (j.type === 'ai-title' && j.aiTitle) ai = j.aiTitle;
        } catch { /* linha quebrada */ }
      }
      return custom || ai;
    }
  } catch { /* sem transcript */ }
  return null;
}
function git(args) {
  try { return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}
function sessaoAtual() {
  const dir = process.cwd();
  const comum = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const origem = {
    dir,
    repo: comum ? path.basename(path.dirname(comum)) : null, // worktree conta como o repo principal
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    sessao_id: process.env.CLAUDE_CODE_SESSION_ID || null,
  };
  const job = process.env.CLAUDE_JOB_DIR;
  if (job) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(job, 'state.json'), 'utf8'));
      return { nome: s.name || s.intent?.slice(0, 60) || null, job: path.basename(job), origem };
    } catch { /* sem state */ }
  }
  const nome = process.env.CLAUDE_SESSION_NAME || tituloDaSessao(origem.sessao_id) || `terminal (${path.basename(dir)})`;
  return { nome, job: null, origem };
}

async function lerStdin() {
  if (process.stdin.isTTY) return '';
  let t = '';
  for await (const pedaco of process.stdin) t += pedaco;
  return t;
}

// o que a mensagem espera para sair (ordem entre mensagens): a anterior, a resposta da pessoa, ou bloqueada
function espera(m) {
  const a = m.aguardando;
  if (!a) return m.depois_de && ['pendente', 'aprovada', 'erro'].includes(m.status) ? `depois da #${m.depois_de} (que já saiu)` : null;
  if (a.motivo === 'bloqueada') {
    return `BLOQUEADA: a #${a.id} ${a.status === 'erro' ? 'deu erro' : a.status === 'descartada' ? 'foi descartada' : 'não existe mais'}; o ${dono()} solta ou descarta`;
  }
  if (a.motivo === 'resposta') return `espera ${a.quem || 'a pessoa'} responder à #${a.id}`;
  return `depois da #${a.id}${m.espera_resposta ? ` e da resposta de ${a.quem || 'a pessoa'}` : ''}`;
}

const linhaMsg = (m) => {
  const agora = Date.now();
  let quando = '';
  if (m.status === 'aprovada' && m.agendar_para) quando = ` (sai ${new Date(m.agendar_para).toLocaleString('pt-BR')})`;
  else if (m.status === 'aprovada' && m.liberar_em > agora) quando = `, sai em ${Math.ceil((m.liberar_em - agora) / 1000)} s`;
  const erro = m.ultimo_erro ? ` · ${m.ultimo_erro}` : '';
  const ordem = espera(m) ? ` · ${espera(m)}` : '';
  return `#${m.id} [${m.status}${quando}] ${m.canal}${m.conta ? `/${m.conta}` : ''} → ${m.destino_nome || `(a escolher: "${m.para_pedido || ''}")`}${ordem}${erro}`;
};

// "485" ou "#485"
const numeroDe = (v, uso) => {
  if (!/^#?\d+$/.test(String(v ?? ''))) sair(uso);
  return Number(String(v).replace('#', ''));
};

async function add(op) {
  if (!op.canal) sair('falta -c/--canal (whatsapp | email | discord)');
  if (!op.para) sair('falta -p/--para (destino)');
  let corpo = op.texto ?? (op.arquivo ? fs.readFileSync(op.arquivo, 'utf8') : await lerStdin());
  corpo = String(corpo || '').replace(/\s+$/, '');
  if (!corpo.trim()) sair('texto vazio (use heredoc, -t ou -f)');
  if (op.substitui != null && !/^#?\d+$/.test(op.substitui)) sair('--substitui pede o número da mensagem (#id)');
  if (op.depois != null && op['depois-da-resposta'] != null) sair('use --depois OU --depois-da-resposta, não os dois');
  const anteriorPedida = op.depois ?? op['depois-da-resposta'];
  const depois = anteriorPedida != null
    ? numeroDe(anteriorPedida, `--${op.depois != null ? 'depois' : 'depois-da-resposta'} pede o número da mensagem anterior (#id)`) : null;
  const s = sessaoAtual();
  const extra = {};
  if (op.cc) extra.cc = op.cc;
  const m = await api('/api/mensagens', {
    metodo: 'POST',
    corpo: {
      canal: op.canal, conta: op.conta, para: op.para, responder_a: op['responder-a'], contexto: op.contexto,
      assunto: op.assunto, corpo, cliente: op.cliente, agendar_para: op.em,
      anexos: (op.anexo || []).map((a) => path.resolve(a)), extra: Object.keys(extra).length ? extra : null,
      sessao_nome: s.nome, sessao_job: s.job, origem: s.origem, app: op.app,
      ...(op.substitui != null ? { substitui_id: Number(String(op.substitui).replace('#', '')) } : {}),
      ...(op.tambem ? { tambem: true } : {}),
      ...(depois != null ? { depois_de: depois, espera_resposta: op['depois-da-resposta'] != null } : {}),
      ...(op.acompanhar != null ? { acompanhar: op.acompanhar === true ? 24 : op.acompanhar } : {}),
    },
  });
  if (m.duplicada) {
    console.log(`= #${m.id} já estava na Central (mesmo destino e texto); nada novo criado. ${linhaMsg(m)}`);
    if (depois != null && !m.depois_de) console.log(`  para pôr na ordem: msg depois ${m.id} ${depois}${op['depois-da-resposta'] != null ? ' --resposta' : ''}`);
    return;
  }
  // a anterior não sai junto: o dono vê esta como versão nova
  if (m.substitui_id && op.substitui == null) {
    console.log(`↻ substituiu a #${m.substitui_id}: esta sessão já tinha mandado para esse destino e ela ainda não tinha saído. Se eram duas mensagens diferentes, mande a anterior de novo com --tambem`);
  } else if (m.substitui_id) console.log(`↻ nova versão da #${m.substitui_id}`);
  if (m.destino_id) {
    console.log(`✓ #${m.id} na Central, esperando o ${dono()} aprovar → ${m.canal}/${m.conta} · ${m.destino_nome}${m.destino_tipo ? ` [${m.destino_tipo}]` : ''}`);
  } else {
    const c = (m.candidatos || []).slice(0, 5).map((x) => x.nome).join(' | ');
    console.log(`⚠ #${m.id} na Central, mas "${op.para}" ${c ? `bate com mais de um destino: ${c}` : 'não bateu com nenhum destino'}. O ${dono()} escolhe no painel; se souber o nome exato, confira com: msg destinos ${op.canal} "${op.para}"`);
  }
  if (m.aviso) console.log(`  aviso: ${m.aviso}`);
  if (espera(m)) console.log(`  ↳ ${espera(m)}${m.depois_de !== depois && depois != null ? ` (a #${depois} ganhou versão nova: vale a #${m.depois_de})` : ''}`);
  if (depois != null && !m.depois_de) console.log(`  ! a Central não gravou a ordem (versão antiga no ar?): confira com msg status ${m.id}`);
  if (m.acompanhar) console.log(`  ↳ acompanhando: se não responder em ${m.acompanhar} h depois de sair, aparece na aba Acompanhar`);
  else if (op.acompanhar != null) console.log(`  ! a Central não gravou o --acompanhar (versão antiga no ar?): confira com msg status ${m.id}`);
  // o que o linter achou (o motivo nunca traz o valor de um segredo)
  const { bloqueios = [], avisos = [] } = m.lint || {};
  for (const b of bloqueios) console.log(`  ✗ bloqueio (${b.regra}): ${b.msg}`);
  for (const a of avisos) console.log(`  ! aviso (${a.regra}): ${a.msg}`);
  if (bloqueios.length) console.log(`  com bloqueio o ${dono()} não consegue aprovar: corrija e mande de novo com --substitui ${m.id}`);
  if (avisos.some((a) => a.regra === 'duplicada')) {
    console.log('  se esta corrige uma dessas, tire a anterior da fila: msg descartar <id> "corrigida pela #' + m.id + '"');
  }
  for (const p of m.parecidas || []) {
    console.log(`  ? parece a #${p.id} (${p.destino_nome || 'sem destino'}, ${p.status}), com outro destino: se esta corrige o destino daquela, msg descartar ${p.id} "destino corrigido na #${m.id}"`);
  }
}

async function main() {
  const [cmd, ...resto] = process.argv.slice(2);
  const { pos, op } = parse(resto);
  carregarConfig(); // o nome do dono (config.json) entra nos textos
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || op.help) return console.log(ajuda());
  if (cmd === 'add') return add(op);
  if (cmd === 'guia') {
    // o guia é escrito com "o dono"; com nome no config.json, sai com o nome dele
    console.log(fs.readFileSync(new URL('../docs/guia-sessoes.md', import.meta.url), 'utf8').replace(/\bdono\b/g, dono()));
    return console.log(await licoesDoDono());
  }
  if (cmd === 'descartar') {
    if (!/^#?\d+$/.test(pos[0] || '')) sair('uso: msg descartar <id> "motivo"');
    const id = Number(String(pos[0]).replace('#', ''));
    const m = await api(`/api/mensagens/${id}/descartar`, { metodo: 'POST', corpo: { motivo: pos[1] || op.motivo || 'descartada pela sessão' } });
    return console.log(`✓ ${linhaMsg(m)}`);
  }
  if (cmd === 'depois') {
    const uso = 'uso: msg depois <id> <anterior> [--resposta]  ou  msg depois <id> --solta';
    const id = numeroDe(pos[0], uso);
    if (op.solta && pos[1] != null) sair(uso);
    const anterior = op.solta ? null : numeroDe(pos[1], uso);
    const m = await api(`/api/mensagens/${id}`, {
      metodo: 'PUT', corpo: anterior == null ? { depois_de: null } : { depois_de: anterior, espera_resposta: !!op.resposta },
    });
    if (anterior != null && !m.depois_de) sair(`a Central não gravou a ordem (versão antiga no ar?): ${linhaMsg(m)}`);
    return console.log(`✓ ${linhaMsg(m)}`);
  }
  if (cmd === 'status') {
    if (!pos[0]) sair('uso: msg status <id>');
    const m = await api(`/api/mensagens/${Number(pos[0])}`);
    console.log(linhaMsg(m));
    if (m.resultado?.resumo) console.log(`  ${m.resultado.resumo}`);
    return;
  }
  if (cmd === 'list' || cmd === 'ls') {
    const lista = await api(`/api/mensagens?status=${op.status || 'pendente,aprovada,enviando,erro'}&limite=${op.n || 20}`);
    if (!lista.length) return console.log('(nada)');
    return lista.forEach((m) => console.log(linhaMsg(m)));
  }
  if (cmd === 'destinos') {
    const [canal, q = ''] = pos;
    if (!canal) sair('uso: msg destinos <canal> "busca"');
    const lista = await api(`/api/destinos?canal=${canal}&q=${encodeURIComponent(q)}${op.conta ? `&conta=${encodeURIComponent(op.conta)}` : ''}`);
    if (!lista.length) return console.log('(nenhum destino)');
    return lista.forEach((d) => console.log(`${d.nome}${d.tipo ? ` [${d.tipo}]` : ''}  ·  ${d.id}${d.detalhe ? `\n    ${d.detalhe}` : ''}`));
  }
  if (cmd === 'entrada') {
    const r = await api(`/api/entrada${op.canal ? `?canal=${op.canal}` : ''}`);
    for (const [c, msg] of Object.entries(r.erros || {})) console.log(`! ${c}: não consegui ler (${msg})`);
    const itens = r.itens.filter((i) => op.tudo || i.precisa).slice(0, Number(op.n) || 20);
    if (!itens.length) return console.log('(nada esperando resposta)');
    for (const i of itens) {
      const fila = i.resposta ? ` [já na Central: #${i.resposta.id} ${i.resposta.status}]` : '';
      console.log(`${i.canal}/${i.conta} · ${i.titulo} · ${new Date(i.em).toLocaleString('pt-BR')} · ${i.motivo || ''}${fila}\n    ${(i.texto || '').slice(0, 400).replace(/\n/g, '\n    ')}\n    responder para: ${i.destino.nome} (${i.destino.id})`);
    }
    if (!op.tudo) console.log(`\n(${r.contagem.precisa} de ${r.contagem.total} são para você; use --tudo para ver o resto)`);
    return;
  }
  if (cmd === 'acompanhar') {
    const r = await api(`/api/acompanhar${op.tudo ? '?tudo=1' : ''}`);
    for (const [c, msg] of Object.entries(r.erros || {})) console.log(`! ${c}: ${msg}`);
    if (!r.itens.length) return console.log(op.tudo ? '(nada em aberto)' : '(nada para acompanhar agora)');
    const quando = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const prazo = (i) => `${i.atrasada ? 'venceu' : 'vence'} ${quando(i.prazo)}`;
    const fila = (i) => (i.cobranca ? ` [cobrança na Central: #${i.cobranca.id} ${i.cobranca.status}]` : '');
    const esperando = r.itens.filter((i) => i.tipo === 'esperando');
    const promessas = r.itens.filter((i) => i.tipo === 'promessa');
    if (esperando.length) console.log(`Esperando resposta (${esperando.length})`);
    for (const i of esperando) {
      console.log(`  ${i.destino.nome} · sua última ${quando(i.em)} · ${prazo(i)}${i.marcada ? ` · marcada (#${i.marcada.id}, ${i.marcada.horas} h)` : ''}${fila(i)}\n    "${i.texto}"`);
    }
    if (promessas.length) console.log(`Promessas (${promessas.length})`);
    for (const i of promessas) {
      const quem = i.promessa.sentido === 'minha' ? `você → ${i.destino.nome}` : `${i.destino.nome} → você`;
      console.log(`  ${quem} · "${i.promessa.trecho}" · ${prazo(i)}${i.promessa.prazo_dito ? ` (disse "${i.promessa.prazo_dito}")` : ' (sem prazo dito: 48 h)'}${fila(i)}\n    "${i.texto}"`);
    }
    return;
  }
  if (cmd === 'contexto') {
    const [canal, destino] = pos;
    if (!canal || !destino) sair('uso: msg contexto <canal> <destino>');
    const c = await api(`/api/contexto?canal=${canal}&destino=${encodeURIComponent(destino)}`);
    if (!c.confiavel) console.log(`! não dá para confiar: ${c.motivo}`);
    const linha = (r, quem) => (r ? `${quem}: ${new Date(r.em).toLocaleString('pt-BR')} — ${(r.texto || '').slice(0, 200)}` : `${quem}: nada no histórico`);
    console.log(linha(c.minhaUltima, 'última sua'));
    console.log(linha(c.deleUltima, 'última dele'));
    return;
  }
  if (cmd === 'ler') {
    const [canal, chat] = pos;
    if (!canal || !chat) sair('uso: msg ler <whatsapp|discord|email> "<alvo>" [-n 30] [--conta X]');
    const r = await api(`/api/ler?canal=${canal}&chat=${encodeURIComponent(chat)}&n=${op.n || 30}${op.conta ? `&conta=${encodeURIComponent(op.conta)}` : ''}`);
    if (r.candidatos) return console.log(`"${chat}" é ambíguo: ${r.candidatos.map((c) => c.nome).join(' | ') || 'nenhum encontrado'}`);
    console.log(`# ${r.conversa.nome}${r.conversa.status ? ` [${r.conversa.status}]` : ''}`);
    if (r.aviso) console.log(`! ${r.aviso}`);
    for (const m of r.mensagens) console.log(`[${String(m.em).slice(0, 16).replace('T', ' ')}] ${m.de}: ${m.texto}`);
    return;
  }
  if (cmd === 'saude') {
    const { segredos: c, copia, ...canais } = await api('/api/saude');
    for (const [canal, h] of Object.entries(canais)) console.log(`${h.ok ? '●' : '○'} ${canal}: ${h.resumo}${h.acao ? `\n    religar: ${h.acao}` : ''}`);
    if (c) {
      const estado = c.desligado ? 'sem cofre configurado: o linter confere só os padrões de texto'
        : c.bloqueia
        ? `o linter barra tudo até ler: ${c.falhas.length ? `${c.falhas.length} de ${c.total} não lidos` : c.erro}`
        : `${c.total} nomes, leitura de ${c.idadeMin} min atrás${c.ok ? '' : ` (a última recarga falhou: ${c.erro})`}`;
      console.log(`${c.bloqueia ? '○' : '●'} cofre do linter: ${estado}`);
    }
    if (copia) console.log(`${copia.aviso ? '!' : copia.estado === 'ok' ? '●' : '○'} ${copia.resumo}`);
    return;
  }
  // macOS: open; Linux: xdg-open; sem nenhum dos dois, mostra o endereço
  if (cmd === 'abrir') return execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [BASE], (e) => { if (e) console.log(BASE); });
  sair(`comando desconhecido: ${cmd}. Veja: msg --help`);
}

main();
