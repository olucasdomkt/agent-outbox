// Ajustes do painel em config.json, junto do banco e fora do repositório (~/.central-mensagens/config.json).
// janelaDesfazerMs e assinaturas (por conta de e-mail) mudam pelo painel (PUT /api/config) e valem na hora.
// senhasDeCliente { NOME_NO_COFRE: 'Cliente' } é só à mão: liberar senha para cliente não é coisa de clique.
// As outras chaves do arquivo (dono, canais, clientes, cofre) são lidas na subida por src/config.js e ficam
// como estão quando o painel grava. sumirRespondidas continua na tabela estado do banco.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { erroHttp } from './db.js';

export const PADRAO = { janelaDesfazerMs: 10000, assinaturas: {}, senhasDeCliente: {} };
const JANELA_MAX = 60000;
const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});

let cache = { arquivo: null, mtime: null, dados: {} };
// trava de teste: nenhum teste lê nem grava o config.json de verdade
const deVerdadeEmTeste = (arquivo) => process.env.NODE_ENV === 'test'
  && path.resolve(arquivo) === path.join(path.dirname(config.dbReal), 'config.json');

// relê só quando o arquivo muda; arquivo ausente ou quebrado = padrão
function lerBruto(arquivo) {
  if (deVerdadeEmTeste(arquivo)) return {};
  let mtime;
  try { mtime = fs.statSync(arquivo).mtimeMs; } catch { return {}; }
  if (cache.arquivo === arquivo && cache.mtime === mtime) return cache.dados;
  let dados = {};
  try { dados = objeto(JSON.parse(fs.readFileSync(arquivo, 'utf8'))); } catch { /* quebrado: segue com o padrão */ }
  cache = { arquivo, mtime, dados };
  return dados;
}

export function lerPreferencias(arquivo = config.preferencias) {
  const b = lerBruto(arquivo);
  const janela = Number(b.janelaDesfazerMs);
  return {
    ...b,
    janelaDesfazerMs: b.janelaDesfazerMs != null && Number.isInteger(janela) && janela >= 0 && janela <= JANELA_MAX
      ? janela : PADRAO.janelaDesfazerMs,
    assinaturas: objeto(b.assinaturas),
    senhasDeCliente: objeto(b.senhasDeCliente),
  };
}

// Grava só o que o painel pode mudar, por cima do que já está no arquivo. Atômico: temporário + rename.
export function gravarPreferencias(parcial, { arquivo = config.preferencias, contasEmail = [] } = {}) {
  const bruto = { ...lerBruto(arquivo) };
  if ('janelaDesfazerMs' in parcial) {
    const n = Number(parcial.janelaDesfazerMs);
    if (!Number.isInteger(n) || n < 0 || n > JANELA_MAX) throw erroHttp(400, `janelaDesfazerMs vai de 0 a ${JANELA_MAX} (ms)`);
    bruto.janelaDesfazerMs = n;
  }
  if ('assinaturas' in parcial) {
    const novas = parcial.assinaturas;
    if (!novas || typeof novas !== 'object' || Array.isArray(novas)) throw erroHttp(400, 'assinaturas é um objeto { conta: texto }');
    const atuais = objeto(bruto.assinaturas);
    for (const [conta, texto] of Object.entries(novas)) {
      if (!contasEmail.includes(conta)) throw erroHttp(400, `conta de e-mail desconhecida: ${conta}`);
      if (texto == null || texto === '') delete atuais[conta];
      else if (typeof texto !== 'string' || texto.length > 2000) throw erroHttp(400, `assinatura de ${conta}: texto de até 2000 caracteres`);
      else atuais[conta] = texto;
    }
    bruto.assinaturas = atuais;
  }
  if (deVerdadeEmTeste(arquivo)) throw new Error('teste tentando gravar o config.json de verdade');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(bruto, null, 2)}\n`);
  fs.renameSync(tmp, arquivo);
  return lerPreferencias(arquivo);
}
