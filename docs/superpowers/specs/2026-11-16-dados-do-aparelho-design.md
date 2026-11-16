# Dados do aparelho no login e nas solicitações — design

**Data:** 16/11/2026 · **Base:** `docs/superpowers/specs/2026-11-04-convite-e-termos-design.md` (política de privacidade), código atual de `apps/api/src/auth/session.ts` e `apps/api/src/citizen/create-request.ts`

## 1. Intenção

A Accemble quer saber em que aparelhos o Alô Cidadão é usado: quantas pessoas usam Android e quantas usam iOS, quais versões do sistema e quais modelos. Com isso, dá para priorizar testes e suporte. Esta entrega **passa a guardar** esses dados. O relatório que conta usuários por plataforma e modelo é um passo seguinte, e precisa que os dados já existam.

Os dados também precisam responder "de que aparelho veio esta solicitação?", mesmo que a pessoa tenha trocado de celular depois.

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- **App (cidadão e agente):** guardar 5 dados do aparelho:
  - o sistema (Android ou iOS), que já é guardado;
  - a versão do sistema;
  - o fabricante;
  - o modelo;
  - a versão do app, que já é guardada.
- **Esses dados ficam em três lugares:**
  - **Aparelhos da conta (`devices`):** a situação atual, atualizada no login e a cada abertura logada. É a base para contar usuários.
  - **Cada login (`sessions`):** uma cópia do aparelho naquele momento.
  - **Cada solicitação (`requests`):** uma cópia do aparelho no envio. A cópia nunca muda depois. Se a pessoa trocar de celular ou atualizar o sistema, as solicitações antigas continuam com o aparelho de quando foram feitas.
- **Painel web (gestores, admins, equipe Alô Cidadão):** cada login guarda o navegador, a versão do navegador, o sistema e a versão do sistema, tirados do cabeçalho `User-Agent`.
- **Política de privacidade:** passa a citar o fabricante, o modelo e a versão do sistema no app, e o navegador e o sistema no painel.

**Não-objetivos (ficam para depois)**

- **Relatório ou tela** de plataformas e modelos (próximo passo).
- **Dados do aparelho nas ações do agente** (conclusão de ordem de serviço). Por enquanto, só a solicitação do cidadão.
- **Conexão do envio:**
  - **O que já existe:** Wi-Fi ou rede móvel, a geração da rede móvel (2G a 5G) e se a solicitação foi criada sem internet já são gravados no primeiro evento de status da solicitação (`status_events.connection`).
  - **Diferença:** no envio feito depois, o tipo de rede gravado é o do momento em que a solicitação saiu.
  - **Decisão do usuário:** o relatório usa esses dados como estão, e nada muda aqui.

**Antiobjetivos**

- **Dados que identificam o aparelho ou o chip:** IMEI, número de série, ID de publicidade, operadora e número do chip. Decisão do usuário, e a LGPD não sustentaria esse uso.
- **Pedir algo ao cidadão:** nenhuma permissão nova e nenhuma tela nova. Os dados saem do sistema do aparelho, sem perguntar.
- **Quebrar o app instalado:** versões antigas do app, que não mandam os campos novos, continuam entrando e enviando solicitações normalmente.

## 3. Abordagens consideradas

- **A. Só completar `devices`:** é a mais simples. Mas guarda só a situação atual: perde o histórico quando o aparelho é atualizado e não liga a solicitação ao aparelho.
- **B. Completar `devices` e gravar uma cópia na sessão e na solicitação (escolhida pelo usuário):** responde tanto "quantos usuários por plataforma" quanto "de que aparelho veio a solicitação". Não muda nenhuma tela.
- **C. Tabela própria de eventos do aparelho:** é a mais flexível. Mas cria uma estrutura nova sem necessidade agora. Dá para chegar nela a partir da B, se um dia for preciso.

## 4. O que fica decidido

**App, dados enviados.** O `deviceInfo()` de `apps/mobile/src/lib/register-device.ts` passa a mandar também:

- `osVersion` (`Device.osVersion`);
- `manufacturer` (`Device.manufacturer`, por exemplo "samsung" ou "Apple");
- `model` (`Device.modelName`, por exemplo "SM-S908E" ou "iPhone 15").

Os três vêm do `expo-device`, que já está instalado. No `deviceInfoSchema` (`packages/shared/src/auth.ts`), os três são **opcionais**, para aceitar app antigo, e têm tamanho máximo. Esses dados chegam à API de duas formas:

- no `device` do login, que já existe;
- no `PUT /me/devices/:installationId`, que já roda a cada abertura logada.

**Solicitação.** O `createRequestInputSchema` ganha um campo **`device` opcional**, com os 5 dados do aparelho. A instalação fica de fora, porque não é dado do aparelho. O app preenche o campo no envio, inclusive no envio da fila offline: quem envia é o mesmo aparelho que criou a solicitação. A API grava o valor na solicitação. Quando o campo falta (app antigo), a coluna fica nula.

**Painel.** O login do painel (`apps/api/src/auth/panel-routes.ts`) lê o `User-Agent` do pedido e guarda só o resultado interpretado (navegador, versão do navegador, sistema, versão do sistema), e não o texto bruto.

O Chrome e o Edge congelam a versão do sistema no `User-Agent`: o Windows 11 aparece como "Windows 10", e o macOS aparece sempre como 10.15.7. A versão do sistema no painel é, portanto, aproximada. O sistema em si e o navegador vêm corretos. Esse limite fica aceito.

**Banco (migração nova):**

- **`devices`:** colunas `os_version`, `manufacturer` e `model`, nulas para aparelhos antigos. São atualizadas como `platform` e `app_version`, com uma diferença: um valor que não veio não apaga o que já estava gravado.
- **`sessions`:** coluna `device jsonb` nula, com o retrato do aparelho, do app ou do navegador, conforme o `audience`.
- **`requests`:** coluna `device jsonb` nula.
- **Formato:** o mesmo `jsonb` já usado em `status_events.connection`, validado por esquema compartilhado em `packages/shared`.
- **Políticas de acesso (RLS):** não mudam. São colunas novas em tabelas que já têm política.

**Exclusão de conta:** ao excluir a conta, a cópia do aparelho na solicitação **fica**. Modelo e sistema não identificam a pessoa, e a solicitação já fica sem nome e sem contato. A cópia nas sessões segue o que já acontece com as sessões.

**Política de privacidade:** decisão do usuário. O texto de `packages/shared/src/legal/privacy.ts` é atualizado, e a data no topo também, mas `TERMS_VERSION` não muda. Hoje só os sócios da Accemble usam o sistema.

Dois efeitos dessa escolha:

- ninguém precisa aceitar de novo;
- os apps já instalados não quebram. O cadastro valida a versão exata (`z.literal(TERMS_VERSION)`), então trocar a versão faria o APK atual falhar no cadastro.

O site (`/privacidade`) é gerado de novo a partir do texto atualizado.

## 5. O que fica para quem implementar

- Escolher a biblioteca que interpreta o `User-Agent`. Precisa ter licença permissiva, como `bowser` (MIT). A `ua-parser-js` 2.x é AGPL e não serve.
- Escolher os nomes exatos dos campos do `jsonb` e os tamanhos máximos.
- Escolher se `deviceInfo()` lê os campos do `expo-device` uma vez só ou a cada chamada. Os valores não mudam com o app aberto.
- Escrever os testes de API:
  - login do app com e sem os campos novos;
  - `PUT /me/devices` sem os campos não apaga os que já existem;
  - criação de solicitação com e sem `device`;
  - login do painel com `User-Agent` de Chrome/Windows, Safari/macOS e ausente.
