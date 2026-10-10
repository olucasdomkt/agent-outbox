// Miniatura de anexo: a imagem, a primeira página do PDF (pdf.js, carregado só quando aparece um) ou o ícone do tipo.
import { useEffect, useRef, useState } from 'react';
import { File, FileSpreadsheet, FileText, FileVideoCamera, Music } from 'lucide-react';
import { urlSegura } from '../lib/url';

const capas = new Map<string, Promise<string>>();

async function capaDoPdf(url: string, largura: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
  }
  const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
  const pagina = await doc.getPage(1);
  const base = pagina.getViewport({ scale: 1 });
  const escala = (largura * 2) / base.width;
  const vista = pagina.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vista.width);
  canvas.height = Math.ceil(vista.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sem canvas');
  await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
  const dado = canvas.toDataURL('image/png');
  void doc.destroy();
  return dado;
}

export function usarCapaPdf(endereco: string | null, largura = 320) {
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const url = endereco ? urlSegura(endereco) : null;
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    const chave = `${url}@${largura}`;
    if (!capas.has(chave)) capas.set(chave, capaDoPdf(url, largura));
    capas.get(chave)!.then((s) => vivo && setSrc(s), () => { capas.delete(chave); if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [url, largura]);
  return { src, falhou };
}

export function IconeArquivo({ mime, nome, tamanho = 20 }: { mime: string; nome?: string; tamanho?: number }) {
  const ext = (nome || '').split('.').pop()?.toLowerCase();
  if (mime.startsWith('video/')) return <FileVideoCamera size={tamanho} strokeWidth={1.75} aria-hidden />;
  if (mime.startsWith('audio/')) return <Music size={tamanho} strokeWidth={1.75} aria-hidden />;
  if (mime === 'text/csv' || ext === 'xlsx' || ext === 'csv') return <FileSpreadsheet size={tamanho} strokeWidth={1.75} aria-hidden />;
  if (mime.startsWith('text/') || mime === 'application/pdf') return <FileText size={tamanho} strokeWidth={1.75} aria-hidden />;
  return <File size={tamanho} strokeWidth={1.75} aria-hidden />;
}

// só renderiza o PDF quando a miniatura entra na tela
export function Miniatura({ url, mime, nome, largura = 320, className = '' }: { url: string; mime: string; nome: string; largura?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visivel) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setVisivel(true); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visivel]);
  const pdf = mime === 'application/pdf';
  const seguro = urlSegura(url);
  const { src, falhou } = usarCapaPdf(pdf && visivel ? seguro : null, largura);
  return (
    <div ref={ref} className={className}>
      {mime.startsWith('image/') && seguro ? (
        <img src={seguro} alt={nome} loading="lazy" decoding="async" />
      ) : pdf && src ? (
        <img src={src} alt={`Primeira página de ${nome}`} />
      ) : (
        <div className="grid h-full min-h-16 w-full place-items-center text-tx-3" aria-label={pdf && !falhou ? 'Carregando a primeira página' : nome}>
          <IconeArquivo mime={mime} nome={nome} tamanho={26} />
        </div>
      )}
    </div>
  );
}
