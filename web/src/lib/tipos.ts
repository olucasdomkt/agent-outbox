// Formatos da API v2 (docs/contrato-api-v2.md) e do que já existia em src/server.js.

export type Canal = 'whatsapp' | 'email' | 'discord';
export type Status = 'pendente' | 'aprovada' | 'enviando' | 'enviada' | 'erro' | 'descartada' | 'substituida';
export type MotivoCodigo = 'ja_mandei' | 'tom' | 'longo' | 'destino' | 'desatualizada' | 'outro' | 'auto_respondida';

export interface ItemLint {
  regra: string;
  msg: string;
  trecho?: string;
  sugestao?: number;
}
export interface Lint {
  bloqueios: ItemLint[];
  avisos: ItemLint[];
  cofre?: boolean;
}

export interface Origem {
  dir?: string;
  repo?: string | null;
  branch?: string | null;
  sessao_id?: string;
}

export interface Destino {
  id: string;
  nome: string;
  tipo?: string | null;
  detalhe?: string | null;
}

export interface Citar {
  id: string;
  sender?: string | null;
  de?: string;
  texto?: string;
  automatica?: boolean;
}

export interface Extra {
  cc?: string | null;
  bcc?: string | null;
  citar?: Citar | null;
  entrada?: string;
  thread_id?: string;
  assunto?: string;
  html?: boolean;
  prazo?: number | string;
  [k: string]: unknown;
}

// ordem entre mensagens: o que a mensagem espera para sair (null = nada). status é o da anterior.
export interface Aguardando {
  id: number;
  motivo: 'anterior' | 'resposta' | 'bloqueada';
  status: Status | null;
  quem: string | null;
}

export interface Mensagem {
  id: number;
  criado_em: number;
  atualizado_em: number;
  status: Status;
  canal: Canal;
  conta: string | null;
  destino_id: string | null;
  destino_nome: string | null;
  destino_tipo: string | null;
  para_pedido: string | null;
  candidatos: Destino[] | null;
  responder_a: string | null;
  contexto: string | null;
  assunto: string | null;
  corpo: string;
  corpo_original: string;
  anexos: string[] | null;
  extra: Extra | null;
  cliente: string | null;
  sessao_nome: string | null;
  sessao_job: string | null;
  agendar_para: number | null;
  aprovado_em: number | null;
  enviado_em: number | null;
  proxima_tentativa: number | null;
  tentativas: number;
  ultimo_erro: string | null;
  resultado: { resumo?: string; [k: string]: unknown } | null;
  app: string | null;
  origem: Origem | null;
  editado?: boolean;
  liberar_em?: number | null;
  substitui_id?: number | null;
  motivo_codigo?: MotivoCodigo | null;
  motivo?: string | null;
  lint?: Lint | null;
  depois_de?: number | null;
  espera_resposta?: number;
  respondida_em?: number | null;
  aguardando?: Aguardando | null;
  /** aba Acompanhar: horas sem resposta até aparecer lá (null = não acompanha) */
  acompanhar?: number | null;
}

export interface Evento {
  em: number;
  tipo: string;
  detalhe: string | null;
}

export interface Versao {
  id: number;
  criado_em: number;
  status: Status;
  corpo: string;
  sessao_nome: string | null;
}

export interface CanalInfo {
  id: Canal;
  nome: string;
  contas: { id: string; nome: string }[];
  contaPadrao: string;
  podeLer: boolean;
  podeEntrada: boolean;
}

export interface Resumo {
  contagens: Partial<Record<Status, number>>;
  pausado: boolean;
  sumirRespondidas: boolean;
  /** nome do dono (config.json) ou null: entra nas prévias e na conversa */
  dono?: string | null;
  /** grafia dos clientes do config.json: agrupa a fila para revisar */
  clientes?: string[];
  canais: CanalInfo[];
}

export interface SaudeCanal {
  ok: boolean;
  resumo: string;
  acao?: string;
  ultimaMensagem?: string | null;
}
// estado da checagem de segredos do linter (sem valores); `bloqueia` = nenhum aprovar passa até ler o cofre;
// `desligado` = sem cofre configurado (o linter confere só os padrões de texto)
export interface SaudeSegredos {
  ok: boolean;
  idadeMin: number | null;
  total: number;
  falhas: string[];
  erro: string | null;
  bloqueia: boolean;
  lendo: boolean;
  desligado?: boolean;
}
// cópia de segurança, para quem tem um script de cópia (src/copia.js); aviso = falhou ou passou de 36 h sem dar certo
export interface SaudeCopia {
  estado: 'ok' | 'falhou' | 'atrasada' | 'desligada';
  ok: boolean;
  aviso: boolean;
  resumo: string;
  erro?: string | null;
  ultimoOk?: number | null;
}
export type Saude = Partial<Record<Canal, SaudeCanal>> & { segredos?: SaudeSegredos; copia?: SaudeCopia };

// Lições (src/licoes.js, docs/contrato-api-v2.md): o que você sempre corrige vira aviso para as sessões
export type TipoLicao = 'evitar' | 'trocar' | 'regra';
export interface EvidenciaLicao { id: number; antes: string; depois: string }
interface BaseLicao {
  tipo: TipoLicao;
  trecho: string | null;
  por: string | null;
  padrao: string | null;
  canal: Canal | null;
  nota: string | null;
  contagem: number;
  evidencias: EvidenciaLicao[];
  texto: string; // como o aviso sai para a sessão
  nome: string | null; // nome do padrão (regra que a máquina confere)
  avisa: boolean; // false = só aparece no msg guia (regra sem trecho, "encurta")
}
export interface SugestaoLicao extends BaseLicao { chave: string; familias: number; sessoes: number }
export interface Licao extends BaseLicao {
  id: number;
  chave: string | null;
  ativa: boolean;
  disparos: number;
  corrigidas: number;
  criado_em: number;
}
// motivo: código do painel, "escrito" (só texto livre) ou null (sem motivo)
export interface GrupoDescarte { nome: string; n: number; semMotivo: number; motivos: { codigo: MotivoCodigo | 'escrito' | null; n: number }[]; exemplos: string[] }
export interface RespostaLicoes {
  janelaDias: number;
  sugestoes: SugestaoLicao[];
  licoes: Licao[];
  edicoes: { total: number; encurtadas: number; encurtadoPct: number };
  descartes: { total: number; semMotivo: number; porCanal: GrupoDescarte[]; porSessao: GrupoDescarte[] };
}
export type CamposLicao = Partial<Pick<Licao, 'tipo' | 'trecho' | 'por' | 'canal' | 'nota' | 'ativa'>>;

export interface Config {
  sumirRespondidas: boolean;
  janelaDesfazerMs: number;
  assinaturas: Record<string, string>;
}

export interface Pessoa {
  nome: string;
  cliente?: string | null;
  apelidos?: string[];
  emails?: string[];
}

// ---- prévias (montadas pelo mesmo código do envio)
export interface Participante {
  jid: string;
  numero: string;
  nome: string;
}
export interface AnexoPrevia {
  caminho: string;
  nome: string;
  bytes: number;
  mime: string;
  url: string;
  enviado?: boolean;
}
export interface FalaContexto {
  id: string;
  sender?: string | null;
  de: string;
  eu: boolean;
  texto: string;
  em: number;
  midia?: string;
}
export interface PreviaWhatsapp {
  canal: 'whatsapp';
  para: { id: string; nome: string; tipo: 'grupo' | 'contato'; participantes?: Participante[] | number };
  corpo: string;
  mencoes: Participante[];
  citar: Citar | null;
  anexos: AnexoPrevia[];
  contexto: FalaContexto[];
}
export interface PreviaEmail {
  canal: 'email';
  conta: { id: string; email: string };
  para: string;
  cc: string | null;
  assunto: string;
  corpo: string;
  assinatura: string;
  html?: boolean;
  thread: { de: string; em: number; trecho: string }[];
  threadAviso?: string;
  anexos?: AnexoPrevia[];
}
export interface PreviaDiscord {
  canal: 'discord';
  alvo: { id: string; nome: string; tipo: 'canal' | 'dm'; servidor?: string };
  corpo: string;
  partes: string[];
  bot: { nome: string };
}
export type Previa = PreviaWhatsapp | PreviaEmail | PreviaDiscord;

// ---- Entrada
export interface FalaEntrada {
  id?: string;
  de: string;
  texto: string;
  em: number;
  sender?: string;
}
// e-mail que chegou: quem mais recebeu, o que veio anexado e se o texto foi lido
export interface Endereco { nome: string; email: string }
export interface AnexoRecebido { nome: string; tipo: string; tamanho: string }
export interface EmailRecebido {
  de: string;
  para: Endereco[];
  cc: Endereco[];
  /** quem mais recebeu além de você e de quem vai receber a resposta: entra no "responder a todos" */
  outros: Endereco[];
  anexos: AnexoRecebido[];
  cortado: boolean;
  lido: boolean;
  /** Reply-To de outro domínio: a resposta vai para quem assinou, e este endereço só entra se ele marcar */
  pedeRespostaEm?: string;
  /** cabeçalho que não sai do Gmail daquele jeito (From repetido, dois endereços): confira antes de responder */
  suspeito?: string;
}
export interface ItemEntrada {
  chave: string;
  canal: Canal;
  conta?: string;
  titulo: string;
  de?: string;
  texto?: string;
  /** e-mail: o histórico que veio citado embaixo do texto */
  citado?: string;
  email?: EmailRecebido;
  mensagens?: FalaEntrada[];
  citar?: Citar | null;
  em: number;
  destino: { id: string; nome: string; tipo?: string };
  precisa: boolean;
  motivo?: string;
  resposta?: { id: number; status: Status } | null;
  extra?: Extra;
  link?: string;
}
export interface RespostaEntrada {
  itens: ItemEntrada[];
  contagem: { precisa: number; total: number };
  erros: Record<string, string>;
}

export interface Conversa {
  conversa?: { id: string; nome: string; status?: string };
  // os campos depois de `texto` só vêm no fio de e-mail
  mensagens?: { em: string; de: string; texto: string; eu?: boolean; email?: string; para?: Endereco[]; cc?: Endereco[]; citado?: string; anexos?: AnexoRecebido[]; cortado?: boolean }[];
  candidatos?: Destino[];
  aviso?: string;
}

export interface ContextoDestino {
  confiavel: boolean;
  motivo?: string | null;
  minhaUltima?: { em: number; texto: string } | null;
  minhasUltimas?: { em: number; texto: string }[];
  deleUltima?: { em: number; texto: string; quem?: string } | null;
}

// ---- relatório
export interface Relatorio {
  dias?: number;
  porCanal: {
    canal: Canal;
    criadas: number;
    enviadas: number;
    descartadas: number;
    editadas: number;
    erros?: number;
    abertas?: number;
    tamanhoMedio?: number;
    aprovacaoMedianaMin?: number | null;
  }[];
  porDia: { dia: string; canal: Canal; criadas: number; enviadas: number; descartadas: number }[];
  descartesPorMotivo: { motivo_codigo: MotivoCodigo | null; n: number }[];
  descartesPorSessao: { sessao: string; criadas: number; descartadas: number; motivoTop: MotivoCodigo | null }[];
  tempoAprovacaoMedianaMin: number | null;
  editadasPct: number;
}

// ---- aba Acompanhar (dentro da Entrada)
export interface ItemAcompanhar {
  chave: string;
  tipo: 'esperando' | 'promessa';
  canal: Canal;
  conta?: string | null;
  destino: { id: string; nome: string; tipo?: string };
  /** esperando: a sua última fala; promessa: quando a mensagem saiu ou chegou */
  em: number;
  prazo: number;
  atrasada: boolean;
  texto: string;
  pergunta?: boolean;
  marcada?: { id: number; horas: number } | null;
  promessa?: { id: number; sentido: 'minha' | 'dele'; trecho: string; prazo_dito: string | null; origem: string; mensagem_id: number | null };
  minhaUltimaEm?: number | null;
  cobranca: { id: number; status: Status } | null;
}
export interface ContagemAcompanhar { total: number; esperando: number; promessas: number }
export interface RespostaAcompanhar {
  itens: ItemAcompanhar[];
  contagem: ContagemAcompanhar;
  erros: Record<string, string>;
}

export type Vista = 'revisar' | 'entrada' | 'acompanhar' | 'fila' | 'enviadas' | 'erro' | 'descartadas' | 'relatorio' | 'ajustes' | 'licoes';
export type VistaLista = 'revisar' | 'fila' | 'enviadas' | 'erro' | 'descartadas';
