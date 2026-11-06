import { TERMS_VERSION } from '../auth.js';
import { LEGAL_NOTICE, list, paragraph, type LegalDocument } from './types.js';

/** Termos de Uso do app e do painel. Texto-modelo: os pontos [A DEFINIR] ficam com o jurídico. */
export const TERMS_OF_USE: LegalDocument = {
  slug: 'termos',
  title: 'Termos de Uso',
  version: TERMS_VERSION,
  notice: LEGAL_NOTICE,
  sections: [
    {
      heading: 'O que é o Alô Cidadão',
      blocks: [
        paragraph(
          'O Alô Cidadão é um serviço para você avisar a prefeitura sobre problemas na cidade, como buraco na rua, lâmpada apagada ou lixo acumulado.',
        ),
        paragraph(
          'Pelo app, você registra a solicitação com foto, local e descrição e acompanha o atendimento. A prefeitura recebe a solicitação no painel, encaminha a uma equipe e avisa você sobre cada mudança.',
        ),
        paragraph(
          'Ao criar sua conta, você aceita estes Termos de Uso. Leia também a Política de Privacidade, que explica como seus dados são tratados.',
        ),
      ],
    },
    {
      heading: 'Quem presta o serviço',
      blocks: [
        paragraph(
          'O atendimento das solicitações é feito pela prefeitura do município que você escolhe no app. É ela quem decide o que fazer com cada solicitação.',
        ),
        paragraph(
          'O app e o painel são fornecidos à prefeitura por [A DEFINIR: razão social], CNPJ [A DEFINIR: CNPJ], com sede em [A DEFINIR: endereço].',
        ),
      ],
    },
    {
      heading: 'Quem pode usar',
      blocks: [
        list(
          'Cidadãos: qualquer pessoa pode criar uma conta e registrar solicitações. [A DEFINIR: idade mínima e regra para menores de idade]',
          'Agentes de campo, gestores e administradores da prefeitura: usam o app ou o painel com o acesso que a prefeitura liberou para cada um.',
          'Equipe do Alô Cidadão: usa o painel interno para implantar o serviço e dar suporte às prefeituras.',
        ),
      ],
    },
    {
      heading: 'Sua conta e o acesso por código',
      blocks: [
        paragraph(
          'A conta é pessoal. No app, você entra com o número do seu celular e um código de 6 dígitos enviado pelo WhatsApp. No painel da prefeitura, o acesso é feito com CPF e um código enviado por e-mail.',
        ),
        list(
          'O código vale por poucos minutos e só pode ser usado uma vez.',
          'Não passe o código a ninguém. Nem a prefeitura nem a equipe do Alô Cidadão pedem o seu código.',
          'Depois de várias tentativas erradas, o código é bloqueado e você precisa pedir um novo.',
          'Mantenha seu nome, celular e e-mail corretos. Você pode alterá-los no Perfil.',
          'Se perder o celular ou suspeitar de uso indevido, troque o número no Perfil ou fale com o suporte.',
        ),
      ],
    },
    {
      heading: 'Uso adequado',
      blocks: [
        paragraph(
          'Use o Alô Cidadão só para avisar a prefeitura sobre problemas reais. Não é permitido:',
        ),
        list(
          'registrar solicitações falsas, repetidas de propósito ou feitas para atrapalhar o atendimento;',
          'escrever textos ofensivos, discriminatórios, ameaças ou palavrões;',
          'enviar fotos de pessoas quando elas não forem necessárias para mostrar o problema, e fotos íntimas ou violentas;',
          'publicar dados pessoais de outras pessoas, como nome, telefone ou documento;',
          'usar a conta de outra pessoa ou tentar acessar dados a que você não tem acesso;',
          'tentar burlar, sobrecarregar ou atacar o app, o painel ou os servidores.',
        ),
        paragraph(
          'Em caso de emergência, como incêndio, acidente ou risco à vida, ligue para os serviços de emergência (190, 192 ou 193). O Alô Cidadão não é um canal de emergência.',
        ),
      ],
    },
    {
      heading: 'O que a prefeitura faz com as solicitações',
      blocks: [
        paragraph(
          'A prefeitura analisa cada solicitação. Ela pode encaminhar a uma equipe, juntar com outras solicitações sobre o mesmo problema, marcar como duplicada ou recusar, informando o motivo.',
        ),
        list(
          'Os prazos mostrados no app são estimativas da prefeitura. Eles podem mudar por falta de material, clima, acesso ao local ou outras prioridades.',
          'Quando a equipe conclui o atendimento, você pode confirmar ou contestar. Sem resposta em 7 dias, a solicitação é concluída automaticamente.',
          'Você pode cancelar uma solicitação enquanto ela ainda não foi encaminhada a uma equipe.',
          'O Alô Cidadão não garante que toda solicitação será atendida: essa decisão é da prefeitura.',
        ),
      ],
    },
    {
      heading: 'Fotos e outros conteúdos enviados',
      blocks: [
        paragraph(
          'As fotos, descrições e comentários que você envia continuam sendo seus. Ao enviá-los, você permite que a prefeitura e as equipes de atendimento os usem para analisar, atender e registrar a solicitação.',
        ),
        paragraph(
          'Você declara que tirou as fotos ou tem o direito de usá-las. Conteúdo que viole estes termos pode ser ocultado ou removido.',
        ),
      ],
    },
    {
      heading: 'Suspensão e exclusão da conta',
      blocks: [
        paragraph(
          'A conta pode ser suspensa se for usada em desacordo com estes termos, por exemplo com solicitações falsas ou ofensivas. Quando possível, avisamos antes e explicamos o motivo.',
        ),
        paragraph(
          'O acesso de agentes, gestores e administradores pode ser desligado pela prefeitura a qualquer momento.',
        ),
        paragraph(
          'Você pode excluir sua conta quando quiser, no Perfil, em “Excluir minha conta”. A Política de Privacidade explica o que acontece com seus dados.',
        ),
      ],
    },
    {
      heading: 'Limitação de responsabilidade',
      blocks: [
        list(
          'O Alô Cidadão é um canal de comunicação. A execução dos serviços é de responsabilidade da prefeitura.',
          'O app pode ficar fora do ar por manutenção, falha de internet ou outros motivos. Solicitações feitas sem conexão ficam guardadas no aparelho e são enviadas quando a rede voltar.',
          'Não respondemos pelo conteúdo que os usuários enviam, mas removemos o que for ilegal ou violar estes termos quando soubermos dele.',
          '[A DEFINIR: limites de responsabilidade da empresa e da prefeitura]',
        ),
      ],
    },
    {
      heading: 'Mudanças nestes termos',
      blocks: [
        paragraph(
          'Estes termos podem mudar. Quando isso acontecer, publicamos a nova versão com a data no topo e avisamos pelo app em caso de mudança importante.',
        ),
      ],
    },
    {
      heading: 'Lei aplicável e foro',
      blocks: [
        paragraph(
          'Estes termos seguem as leis do Brasil. Fica eleito o foro de [A DEFINIR: foro] para resolver qualquer questão, ressalvado o direito do consumidor de buscar o foro do seu domicílio.',
        ),
      ],
    },
    {
      heading: 'Contato',
      blocks: [
        paragraph(
          'Dúvidas sobre estes termos: [A DEFINIR: e-mail de contato]. Dúvidas sobre uma solicitação: fale com a prefeitura do seu município.',
        ),
      ],
    },
  ],
};
