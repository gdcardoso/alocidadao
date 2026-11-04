import { TERMS_VERSION } from '../auth.js';
import { LEGAL_NOTICE, list, paragraph, type LegalDocument } from './types.js';

/**
 * Política de Privacidade. É de ciência, não de consentimento: o tratamento se apoia na
 * execução de políticas públicas (LGPD, art. 7º, III e art. 23). Texto-modelo: os pontos
 * [A DEFINIR] ficam com o jurídico.
 */
export const PRIVACY_POLICY: LegalDocument = {
  slug: 'privacidade',
  title: 'Política de Privacidade',
  version: TERMS_VERSION,
  notice: LEGAL_NOTICE,
  sections: [
    {
      heading: 'Sobre esta política',
      blocks: [
        paragraph(
          'Esta política explica quais dados pessoais o Alô Cidadão usa, para quê, com quem eles são compartilhados e como você pode exercer seus direitos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, a LGPD).',
        ),
        paragraph(
          'Ela serve para você ficar ciente de como seus dados são tratados. O tratamento é feito para prestar um serviço público e não depende de você marcar uma autorização.',
        ),
      ],
    },
    {
      heading: 'Quem trata seus dados',
      blocks: [
        list(
          'A prefeitura do município que você escolhe no app é a controladora: é ela quem decide como os dados das solicitações são usados.',
          'A empresa que fornece o Alô Cidadão, [A DEFINIR: razão social], CNPJ [A DEFINIR: CNPJ], com sede em [A DEFINIR: endereço], atua como operadora: trata os dados em nome da prefeitura, seguindo as instruções dela.',
          '[A DEFINIR: confirmação dos papéis de controladora e operadora pelo jurídico]',
        ),
      ],
    },
    {
      heading: 'Quais dados coletamos',
      blocks: [
        paragraph('Coletamos só o necessário para cada tipo de pessoa que usa o serviço.'),
        paragraph('Cidadão:'),
        list(
          'nome e número de celular;',
          'e-mail, se você quiser informar;',
          'a prefeitura escolhida;',
          'nas solicitações: fotos, descrição, categoria, localização e endereço do problema, e a data e a hora do registro;',
          'confirmações, contestações e comentários sobre o atendimento.',
        ),
        paragraph('Agente de campo:'),
        list(
          'nome, número de celular e e-mail;',
          'fotos e relato do atendimento;',
          'localização e hora em que a foto do atendimento foi tirada.',
        ),
        paragraph('Gestores e administradores da prefeitura e equipe do Alô Cidadão:'),
        list('nome, CPF e e-mail.'),
        paragraph('Todas as pessoas:'),
        list(
          'registros de acesso: data e hora de cada entrada e do último uso, e o aparelho usado;',
          'registros de auditoria: quem fez cada ação nas solicitações e nas contas, e quando a equipe do Alô Cidadão consultou dados pessoais;',
          'dados do aparelho: sistema (Android ou iOS), versão do app, um identificador da instalação e o código usado para enviar notificações;',
          'dados da conexão em cada envio: tipo de rede, tempo de resposta e se o envio foi feito sem internet.',
        ),
        paragraph(
          'A localização do aparelho é usada para sugerir a prefeitura e marcar o local da solicitação ou do atendimento. O app pede essa permissão na hora em que precisa, e você pode ajustar o local no mapa.',
        ),
      ],
    },
    {
      heading: 'Para que usamos os dados',
      blocks: [
        list(
          'Registrar, analisar, encaminhar e atender as solicitações.',
          'Criar sua conta e confirmar que é você, com o código enviado por SMS ou e-mail.',
          'Avisar sobre cada mudança na solicitação, por notificação no app e, em alguns casos, por e-mail.',
          'Permitir que a prefeitura organize equipes, prazos e o trabalho de campo.',
          'Dar suporte, prevenir fraudes e abusos e manter o serviço seguro.',
          'Medir a qualidade da conexão para que o app funcione bem também com internet fraca.',
          'Cumprir obrigações legais, como guardar os registros de acesso.',
        ),
        paragraph('Não vendemos seus dados e não os usamos para publicidade.'),
      ],
    },
    {
      heading: 'Base legal',
      blocks: [
        list(
          'Execução de políticas públicas pela administração pública (LGPD, art. 7º, III), dentro das competências da prefeitura (LGPD, art. 23).',
          'Cumprimento de obrigação legal (LGPD, art. 7º, II) para os registros de acesso, que precisam ser guardados (Marco Civil da Internet, Lei nº 12.965/2014, art. 15).',
        ),
      ],
    },
    {
      heading: 'Com quem compartilhamos',
      blocks: [
        list(
          'Com a prefeitura escolhida: gestores, administradores e agentes de campo veem as solicitações e o que for necessário para atendê-las, como seu nome e o local do problema.',
          'Com fornecedores que fazem o serviço funcionar: hospedagem e armazenamento de dados e fotos, envio de e-mail, envio de SMS e envio de notificações (Google, no Android, e Apple, no iPhone). [A DEFINIR: lista de fornecedores]',
          'Com autoridades, quando a lei ou uma ordem judicial exigir.',
        ),
        paragraph(
          'Outros cidadãos não veem suas solicitações, seu nome ou seu contato. As notificações levam só o protocolo e a situação da solicitação, sem nome, endereço ou descrição.',
        ),
        paragraph(
          'Alguns fornecedores podem guardar dados fora do Brasil, sempre com as garantias exigidas pela LGPD. [A DEFINIR: transferência internacional]',
        ),
      ],
    },
    {
      heading: 'O que a equipe do Alô Cidadão vê',
      blocks: [
        paragraph(
          'A equipe do Alô Cidadão vê só o necessário para dar suporte. O celular e o e-mail do cidadão aparecem mascarados, por exemplo (62) •••••-1234 e g•••@exemplo.com, e o CPF aparece só em parte.',
        ),
        paragraph('Cada consulta a dados pessoais fica registrada, com quem consultou e quando.'),
      ],
    },
    {
      heading: 'Por quanto tempo guardamos e como excluir',
      blocks: [
        list(
          'Os dados da conta ficam guardados enquanto ela estiver ativa.',
          'As solicitações fazem parte do registro do serviço público da prefeitura e são guardadas por [A DEFINIR: prazo de guarda].',
          'Os registros de acesso são guardados por [A DEFINIR: prazo de guarda], respeitado o mínimo de 6 meses exigido pelo Marco Civil da Internet.',
          'As cópias de segurança são mantidas por até 30 dias e depois apagadas.',
        ),
        paragraph(
          'Você pode excluir sua conta no app, no Perfil, em “Excluir minha conta”. Ao excluir, apagamos seu nome, celular, e-mail e CPF, encerramos suas sessões e desligamos seus aparelhos. As solicitações que você fez continuam com a prefeitura, sem seu nome e sem seu contato, porque fazem parte do registro do serviço.',
        ),
      ],
    },
    {
      heading: 'Segurança',
      blocks: [
        list(
          'A conexão entre o app, o painel e os servidores é criptografada.',
          'O acesso é feito por código enviado ao seu celular ou e-mail, com bloqueio depois de várias tentativas erradas.',
          'Cada prefeitura só vê os próprios dados, com o isolamento garantido no banco de dados.',
          'As fotos só podem ser abertas por links temporários.',
          'O histórico das solicitações não pode ser alterado, só acrescentado.',
        ),
        paragraph(
          'Se acontecer um incidente de segurança que possa causar risco ou dano relevante, avisamos você e a Autoridade Nacional de Proteção de Dados (ANPD), como a lei determina.',
        ),
      ],
    },
    {
      heading: 'Seus direitos',
      blocks: [
        paragraph('A LGPD (art. 18) garante a você, entre outros, o direito de:'),
        list(
          'confirmar se tratamos seus dados e ter acesso a eles;',
          'corrigir dados incompletos, errados ou desatualizados;',
          'pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados em desacordo com a lei;',
          'pedir a portabilidade dos dados a outro fornecedor;',
          'saber com quem seus dados foram compartilhados.',
        ),
        paragraph(
          'Nome, celular e e-mail podem ser alterados no próprio app, no Perfil. Para os outros pedidos, fale com o encarregado pelo contato abaixo ou com a prefeitura do seu município. Se não ficar satisfeito com a resposta, você pode reclamar à ANPD.',
        ),
      ],
    },
    {
      heading: 'Encarregado pelo tratamento de dados',
      blocks: [
        paragraph(
          'O encarregado (DPO) é quem atende pedidos e dúvidas sobre seus dados: [A DEFINIR: encarregado e contato]. A prefeitura também tem o próprio encarregado: [A DEFINIR: encarregado da prefeitura e contato].',
        ),
      ],
    },
    {
      heading: 'Mudanças nesta política',
      blocks: [
        paragraph(
          'Esta política pode mudar. Quando isso acontecer, publicamos a nova versão com a data no topo e avisamos pelo app em caso de mudança importante.',
        ),
      ],
    },
  ],
};
