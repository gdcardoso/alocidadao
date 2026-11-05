# Código de entrada pelo WhatsApp — design

**Data:** 05/11/2026 · **Base:** plano de acesso (`docs/superpowers/plans/2026-10-23-acesso.md`), `apps/api/src/messaging/sms.ts`

Hoje o código de 6 dígitos do app (entrada e troca de celular) iria por SMS, mas não há provedor de SMS. Na outra integração do usuário, com a Comtele, operadoras barram SMS antes de chegar ao destinatário. Decisão do usuário: o código passa a ir **pelo WhatsApp**, e o SMS sai do sistema. O sistema não pode depender do provedor de WhatsApp: trocar de provedor depois não pode afetar telas, regras nem banco.

## 1. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- O código do app (entrada de cidadão e agente, e troca de celular no perfil) vai pelo WhatsApp, por uma interface nossa, sem saber qual provedor está por trás.
- Primeiro provedor: a **API oficial da Meta (WhatsApp Cloud API)**, sem intermediário, por ser a mais barata (decisão do usuário).
- O SMS sai: interface, textos do app, do painel, do convite e dos documentos legais.

**Não-objetivos**

- Convite por WhatsApp: o convite continua só por e-mail (decisão do usuário; o cadastro do agente já exige e-mail).
- Painel: o código continua por e-mail.
- Mandar o código também por e-mail, ou usar o e-mail como alternativa quando o WhatsApp não chega. O fluxo continua como está no código (decisão do usuário): o e-mail só entra no caso do número reaproveitado (90 dias).
- Saber se a mensagem foi entregue (avisos da Meta por webhook). Se não chegar, a pessoa usa "Reenviar", como hoje (**minha decisão**).
- Notificações ou outros avisos pelo WhatsApp.
- Preenchimento automático do código vindo do WhatsApp no Android (exige integração nativa à parte). O botão "Copiar código" da mensagem basta.

**Antiobjetivos**

- Nome de provedor (Meta, Twilio etc.) espalhado pelas rotas, telas, códigos de erro ou banco.
- Produção mandando o código para o log por engano.
- Código ou token do provedor aparecendo em log de produção.
- Mudar o fluxo de entrada (bloqueio após 5 erros, limites de envio e reenvio, regra dos 90 dias).

## 2. Interface e adaptadores

- Uma interface única para "enviar o código de verificação para este celular" (`+55…`), que recebe o código, não um texto pronto. O texto é responsabilidade do adaptador, porque no WhatsApp a mensagem é um modelo aprovado pelo provedor.
- O nome da interface, do erro e das dependências não cita WhatsApp nem SMS (ex.: "código pelo celular", `phoneCode`). **Minha decisão:** o erro `sms_not_configured` passa a `phone_code_not_configured`, e o app mostra "Não foi possível enviar o código agora. Tente mais tarde."
- **Adaptadores:**
  - `log`: o código sai no log da API, sem custo. Usado no desenvolvimento e na homologação.
  - `meta`: WhatsApp Cloud API. Envia a mensagem com o modelo de autenticação (categoria "authentication"), no formato padrão da Meta: o código vai como parâmetro do corpo e do botão "Copiar código" (`sub_type: url`, índice 0). Idioma pela configuração, com `pt_BR` como padrão; versão da Graph API com valor padrão no código, trocável pela configuração. O número vai só com dígitos (o adaptador tira o `+`); os celulares são sempre brasileiros (`phoneSchema`).
- **Escolha pelo ambiente:** uma variável (ex.: `PHONE_CODE_PROVIDER=log|meta`) e as credenciais do adaptador escolhido (ex.: `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_TEMPLATE_NAME`, `META_WA_TEMPLATE_LANGUAGE`, versão da Graph API). O nome do modelo vem da configuração, porque é criado no painel da Meta.
  - Fora de produção, sem variável: `log` (como hoje).
  - Em produção, sem variável: a API responde 503 `phone_code_not_configured` (como hoje com o SMS).
  - `log` em produção só quando escrito explicitamente (`PHONE_CODE_PROVIDER=log`), com um aviso no log ao iniciar. A homologação roda em produção e usa `log`, então lá o código aparece no log de propósito. Credencial faltando para `meta`: a API não sobe. O código fixo de teste (`AUTH_DEV_FIXED_CODE`) continua com a regra de hoje; a homologação fica para o Plano 8.
- Trocar de provedor = escrever um adaptador novo e mudar a configuração. Nada fora da pasta de mensagens muda.

## 3. Falhas

- O adaptador `meta` tem tempo limite (10 s) e não registra o código nem o token; o celular aparece mascarado no log.
- Se o provedor recusar ou não responder, a rota responde 503 `phone_code_not_sent` e o app mostra "Não foi possível enviar o código agora. Tente de novo em instantes." Vale nas duas rotas que mandam código pelo celular (`/auth/phone/start` e `/me/phone/start`). As duas mensagens do app (sem provedor e falha no envio) são diferentes de propósito.
- **Minha decisão:** a falha não prende a pessoa. O código que não saiu é apagado (por uma função nova no banco, com as permissões no padrão da decisão 0001), então não conta para a espera de 60 s nem para o limite de 5 por hora do número. Os limites por IP e por conta (`/me/phone/start`) continuam contando a tentativa; é aceito, porque são folgados.
- Os limites atuais por número, por IP e por conta continuam valendo.

## 4. Textos

- App, telas Entrar, Código, Trocar celular e Laboratório (`apps/mobile/src/app/...`): "SMS" passa a "WhatsApp" (ex.: "Enviaremos um código pelo WhatsApp para confirmar que o número é seu.", "Enviado pelo WhatsApp para (62) 9…").
- Painel, cadastro de agente (`AgentDialog`): "Ele recebe o código de acesso pelo WhatsApp neste número."
- Convite do agente (`apps/api/src/messaging/invites.ts`): "Você recebe um código pelo WhatsApp."
- Termos e Política (`packages/shared/src/legal/*`): o código é enviado "pelo WhatsApp"; na lista de fornecedores, "envio de mensagens pelo WhatsApp (Meta)" no lugar de "envio de SMS". **Minha decisão:** sem trocar `TERMS_VERSION`, porque os textos são modelo e ainda não estão em produção.
- Comentários e documentos (`docs/planejamento-mvp.md`, `.env.example`, comentários no código) deixam de falar em SMS. A pendência "convite também por SMS" sai do Plano 8.

## 5. Do lado do usuário (fora do código, em paralelo)

Conta empresarial da Meta verificada com o CNPJ, um número de celular só para isso (fora do app WhatsApp comum), nome de exibição "Alô Cidadão" aprovado e o modelo de autenticação aprovado. As credenciais entram na configuração da produção no Plano 8.

## 6. Deixado para o builder

- Nomes exatos da interface, dos arquivos, das variáveis e dos erros, respeitando a regra de não citar o provedor fora do adaptador. A troca do nome `sms` nas dependências da API e nos testes que o injetam é esperada, mesmo deixando o diff maior.
- Cliente HTTP do adaptador `meta` (o `fetch` do Node basta) e testes com o provedor simulado.
- Como a falha de envio libera o reenvio imediato.
