// O que muda de canal para canal: nome, ícone, faixas de tamanho e formatação do editor.
import { siDiscord, siGmail, siWhatsapp } from 'simple-icons';
import type { Canal } from './tipos';
import { useFoto } from './fotos';
import { dados, useSel } from './loja';

export const NOME_CANAL: Record<Canal, string> = { whatsapp: 'WhatsApp', email: 'E-mail', discord: 'Discord' };
// os canais ligados nesta Central, como o servidor informa: e-mail e Discord só aparecem depois de configurados
export const useCanais = (): Canal[] => useSel(dados, (e) => e.resumo?.canais)?.map((c) => c.id) ?? ['whatsapp'];

// tamanho: verde até "bom", âmbar até "limite", vermelho acima
export const FAIXAS: Record<Canal, { bom: number; limite: number | null; nota: (n: number) => string | null }> = {
  whatsapp: { bom: 600, limite: 1000, nota: (n) => (n > 1000 ? 'longa demais para WhatsApp' : n > 600 ? 'acima dos 600 que cabem bem no WhatsApp' : null) },
  email: { bom: 2500, limite: null, nota: () => null },
  discord: { bom: 2000, limite: null, nota: (n) => (n > 2000 ? `vai em ${Math.ceil(n / 1990)} partes` : null) },
};

export function faixaDoTamanho(canal: Canal, n: number): 'ok' | 'aviso' | 'perigo' {
  const f = FAIXAS[canal];
  if (f.limite && n > f.limite) return 'perigo';
  if (n > f.bom) return 'aviso';
  return 'ok';
}

// marcação de cada canal: Cmd+B, Cmd+I, Cmd+Shift+X, código, listas
export interface Formatacao {
  negrito: string | null;
  italico: string | null;
  tachado: string | null;
  codigo: string | null;
  bloco: string | null;
  lista: boolean;
  citacao: boolean;
  explicacao: string;
}
export const FORMATACAO: Record<Canal, Formatacao> = {
  whatsapp: { negrito: '*', italico: '_', tachado: '~', codigo: '`', bloco: '```', lista: true, citacao: true, explicacao: 'WhatsApp: *negrito*, _itálico_, ~tachado~, ```mono```' },
  discord: { negrito: '**', italico: '*', tachado: '~~', codigo: '`', bloco: '```', lista: true, citacao: true, explicacao: 'Discord: markdown (**negrito**, *itálico*, `código`)' },
  email: { negrito: null, italico: null, tachado: null, codigo: null, bloco: null, lista: true, citacao: false, explicacao: 'E-mail sai em texto simples: o Gmail mostra exatamente o que você digitar.' },
};

export const TIPO_DESTINO: Record<string, string> = { grupo: 'Grupo', contato: 'Conversa direta', canal: 'Canal', pessoa: 'Mensagem privada', email: 'E-mail' };

const MARCAS = { whatsapp: siWhatsapp, email: siGmail, discord: siDiscord } as const;

// ícone do canal: logo da marca (simple-icons)
export function Glifo({ canal, tamanho = 16, className = '' }: { canal: Canal; tamanho?: number; className?: string }) {
  const marca = MARCAS[canal];
  return (
    <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} className={className} aria-hidden style={{ color: `var(--c-${canal})`, flex: 'none' }}>
      <path d={marca.path} fill="currentColor" />
    </svg>
  );
}

// Nas listas: a foto de quem recebe no lugar do ícone (só WhatsApp e só quando existe), com o anel verde para o
// canal continuar à vista. Enquanto a foto não chega, e para quem não tem, o ícone de sempre.
export function GlifoOuFoto({ canal, jid, tamanho = 16, className = '' }: { canal: Canal; jid?: string | null; tamanho?: number; className?: string }) {
  const src = useFoto(canal === 'whatsapp' ? jid : null);
  if (!src) return <Glifo canal={canal} tamanho={tamanho} className={className} />;
  const lado = tamanho + 4;
  return <img src={src} alt="" aria-hidden className={`foto-canal anima-aparece flex-none rounded-full object-cover ${className}`} style={{ width: lado, height: lado }} />;
}

// etiqueta da aplicação com cor estável por nome
export function matiz(nome: string | null | undefined) {
  let h = 0;
  for (const c of nome || '?') h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
