// Endereço que veio de dado (corpo de mensagem, anexo, prévia do servidor) só vira link
// ou imagem se for http(s) ou caminho da própria Central. javascript:, data:, vbscript:, file: e afins
// voltam null, e quem chama mostra o texto sem link. Um link malicioso aqui dentro conseguiria aprovar
// e enviar mensagens em seu nome.

const PERMITIDOS = new Set(['http:', 'https:']);

export function urlSegura(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const bruto = u.trim();
  if (!bruto) return null;
  // caractere de controle no meio é truque para esconder o esquema ("java\tscript:")
  if (/[\u0000-\u001f\u007f]/.test(bruto)) return null;
  let url: URL;
  try {
    url = new URL(bruto, location.origin);
  } catch {
    return null;
  }
  return PERMITIDOS.has(url.protocol) ? url.href : null;
}

// mesmo endereço com um parâmetro a mais (ex.: ?baixar=1), sem montar string na mão
export function comParametro(seguro: string, chave: string, valor: string): string {
  const url = new URL(seguro);
  url.searchParams.set(chave, valor);
  return url.href;
}
