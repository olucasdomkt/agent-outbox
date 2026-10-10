// Diretório de pessoas (~/.central-mensagens/pessoas.json): de que cliente cada pessoa é. O linter usa para o
// aviso de "cliente cruzado" (src/lint.js). É opcional e escrito à mão; fica fora do repositório.
// Formato: [{ "nome": "Nome Sobrenome", "cliente": "Nome do cliente", "apelidos": ["Apelido"], "emails": ["a@exemplo.com"] }]
import fs from 'node:fs';
import { config } from './config.js';

let cache = { arquivo: null, mtime: 0, lista: [] };

// relê só quando o arquivo muda; sem arquivo, diretório vazio
export function lerPessoas(arquivo = config.pessoas) {
  let mtime;
  try { mtime = fs.statSync(arquivo).mtimeMs; } catch { return []; }
  if (cache.arquivo === arquivo && cache.mtime === mtime) return cache.lista;
  let lista = [];
  try {
    const j = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    lista = (Array.isArray(j) ? j : j.pessoas || []).filter((p) => p && p.nome);
  } catch { /* arquivo quebrado: segue sem diretório */ }
  cache = { arquivo, mtime, lista };
  return lista;
}
