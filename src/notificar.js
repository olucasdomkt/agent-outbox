// Notificação nativa do macOS (Central de Notificações). Silenciosa se falhar; fora do macOS não faz nada
// (o painel aberto já mostra o que chegou).
import { execFile } from 'node:child_process';
import { config } from './config.js';

const aspas = (s) => String(s || '').replace(/[\\"]/g, ' ').slice(0, 180);

export function notificar(titulo, texto) {
  if (!config.notificarMac || process.platform !== 'darwin' || process.env.NODE_ENV === 'test') return;
  const script = `display notification "${aspas(texto)}" with title "Central de Mensagens" subtitle "${aspas(titulo)}"`;
  execFile('osascript', ['-e', script], () => {});
}
