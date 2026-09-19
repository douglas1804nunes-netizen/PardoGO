function getLegalContent() {
  return {
    version: '2026-06-29-etapa11',
    terms: {
      title: 'Termos de uso do PardoGo',
      summary: 'Uso responsável da plataforma local de intermediação de corridas, com regras para passageiro, motorista, cancelamento, contato e suporte.',
      items: [
        'O passageiro deve informar origem, destino, forma de pagamento e observações verdadeiras.',
        'O motorista deve manter dados do veículo, placa e documentos atualizados para análise administrativa.',
        'A plataforma registra eventos operacionais, corridas, cancelamentos, contatos, avaliações e suporte para segurança e auditoria.',
        'Corridas podem ser canceladas por passageiro, motorista ou administrador quando houver motivo operacional ou de segurança.',
        'Este MVP é uma base técnica e precisa de revisão jurídica antes do lançamento comercial.'
      ]
    },
    privacy: {
      title: 'Política de privacidade e LGPD',
      summary: 'Dados pessoais são usados para cadastro, login, corrida, localização, contato, suporte, segurança e auditoria.',
      items: [
        'Dados tratados: nome, telefone, senha criptografada, perfil, localização de corrida, histórico, contatos, avaliações e chamados.',
        'A localização é usada para calcular rota, estimar preço, exibir origem/destino e apoiar a operação da corrida.',
        'A senha não é salva em texto puro; o sistema usa hash criptográfico.',
        'O usuário deve poder solicitar correção ou exclusão de dados quando a operação real for publicada.',
        'Antes do lançamento, a empresa deve validar base legal, retenção de dados e canal oficial de atendimento LGPD.'
      ]
    }
  };
}

module.exports = {
  getLegalContent
};
