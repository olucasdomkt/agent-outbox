// Uma parte da tela que quebra não derruba a Central inteira: mostra o erro ali e deixa tentar de novo.
// Trocar de mensagem ou de aba (chave) limpa o erro sozinho.
import { Component, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface Props { children: ReactNode; rotulo: string; chave?: unknown }

export class Protegido extends Component<Props, { erro: Error | null }> {
  state: { erro: Error | null } = { erro: null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidUpdate(anterior: Props) {
    if (anterior.chave !== this.props.chave && this.state.erro) this.setState({ erro: null });
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6" role="alert">
        <div className="flex max-w-md flex-col items-start gap-2 rounded-painel border border-danger-line bg-danger-soft p-5">
          <p className="flex items-center gap-2 font-bold text-danger">
            <TriangleAlert size={18} strokeWidth={2.2} aria-hidden /> {this.props.rotulo} quebrou
          </p>
          <p className="text-ui text-tx-2">O resto da Central continua funcionando. O erro foi este:</p>
          <code className="w-full rounded-item bg-surface px-3 py-2 font-mono text-meta break-words text-tx">{erro.message}</code>
          <button type="button" className="btn btn-pequeno mt-1" onClick={() => this.setState({ erro: null })}>Tentar de novo</button>
        </div>
      </div>
    );
  }
}
