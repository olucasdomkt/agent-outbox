// Tema: segue o sistema; "claro" e "escuro" ficam gravados neste navegador (public/tema.js aplica antes de pintar).
export type Tema = 'sistema' | 'claro' | 'escuro';

export function lerTema(): Tema {
  try {
    const t = localStorage.getItem('central:tema');
    return t === 'claro' || t === 'escuro' ? t : 'sistema';
  } catch {
    return 'sistema';
  }
}

export function aplicarTema(t: Tema) {
  const raiz = document.documentElement;
  if (t === 'sistema') delete raiz.dataset.theme;
  else raiz.dataset.theme = t === 'claro' ? 'light' : 'dark';
  try {
    if (t === 'sistema') localStorage.removeItem('central:tema');
    else localStorage.setItem('central:tema', t);
  } catch { /* sem storage: vale só nesta aba */ }
}
