// Foto de perfil do WhatsApp (contato ou grupo) para pôr por cima das iniciais. A Central guarda a miniatura e
// responde 200 (tem), 204 (não tem) ou 202 (ainda perguntando ao WhatsApp: tenta de novo daqui a pouco).
import { useEffect, useState } from 'react';

const TEM_FOTO = /@(?:s\.whatsapp\.net|lid|g\.us)$/;
// a Central pergunta uma foto por vez: na primeira abertura de uma lista grande a vez pode levar uns 2 minutos
const ESPERAS = [1500, 4000, 10000, 20000, 40000, 60000];
// o que esta página já sabe: a URL do blob, null (sem foto) ou a busca em andamento
const sabidas = new Map<string, string | null | Promise<string | null | undefined>>();

// undefined = não deu para saber agora (rede, ou o WhatsApp ainda não respondeu): a próxima tela pergunta de novo
async function buscar(jid: string): Promise<string | null | undefined> {
  for (let n = 0; ; n++) {
    let r: Response;
    try {
      r = await fetch(`/api/fotos/whatsapp/${encodeURIComponent(jid)}`);
    } catch {
      return undefined;
    }
    if (r.status === 200) return URL.createObjectURL(await r.blob());
    if (r.status === 204) return null;
    if (r.status !== 202 || n >= ESPERAS.length) return undefined;
    await new Promise((ok) => { window.setTimeout(ok, ESPERAS[n]); });
  }
}

export function useFoto(jid?: string | null): string | null {
  const chave = jid && TEM_FOTO.test(jid) ? jid : null;
  const [, repintar] = useState(0);
  useEffect(() => {
    if (!chave) return undefined;
    let vivo = true;
    let p = sabidas.get(chave);
    if (p === undefined) {
      p = buscar(chave).then((url) => {
        if (url === undefined) sabidas.delete(chave);
        else sabidas.set(chave, url);
        return url;
      });
      sabidas.set(chave, p);
    }
    if (p instanceof Promise) p.then(() => { if (vivo) repintar((n) => n + 1); });
    return () => { vivo = false; };
  }, [chave]);
  const sabida = chave ? sabidas.get(chave) : null;
  return typeof sabida === 'string' ? sabida : null;
}
