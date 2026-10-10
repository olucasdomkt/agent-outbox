// Motivos de descarte com tecla (spec, seção 5). Sem motivo é o 0 ou o botão, nunca o padrão.
import type { MotivoCodigo } from './tipos';

export const MOTIVOS: { codigo: MotivoCodigo; tecla: string; nome: string; dica: string }[] = [
  { codigo: 'ja_mandei', tecla: '1', nome: 'Já mandei', dica: 'você respondeu por fora' },
  { codigo: 'tom', tecla: '2', nome: 'Tom errado', dica: 'formal, frio ou com cara de IA' },
  { codigo: 'longo', tecla: '3', nome: 'Longo demais', dica: 'não cabe no canal' },
  { codigo: 'destino', tecla: '4', nome: 'Destino ou cliente errado', dica: 'pessoa, grupo ou cliente trocado' },
  { codigo: 'desatualizada', tecla: '5', nome: 'Não é mais verdade', dica: 'o fato mudou' },
];

export const NOME_MOTIVO: Record<MotivoCodigo, string> = {
  ja_mandei: 'Já mandei',
  tom: 'Tom errado',
  longo: 'Longo demais',
  destino: 'Destino ou cliente errado',
  desatualizada: 'Não é mais verdade',
  outro: 'Outro motivo',
  auto_respondida: 'Você já tinha respondido (automático)',
};
