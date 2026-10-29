# Notificações (Plano 7) — design

**Data:** 29/10/2026 · **Base:** `docs/planejamento-mvp.md` (seção "Notificações"), `docs/decisoes/0002-recursos-nativos-offline-e-push.md`, seção "Plano 7" de `docs/superpowers/plans/2026-10-22-spikes-pendencias.md`, `docs/superpowers/specs/2026-10-22-telas-e-regras-mvp-design.md`

Avisar cada pessoa só quando ela precisa saber ou agir: o cidadão quando a situação da solicitação muda, o agente quando chega trabalho para a equipe dele, o gestor no painel quando algo pede a atenção dele. Hoje o app já promete "Você recebe um aviso a cada mudança" e a confirmação automática em 7 dias, e nada disso acontece.

## 1. Intenção

Ideias que guiam as decisões (do usuário):

1. **Não avisar tudo.** O cidadão só fica sabendo de mudança de situação. Passos internos da prefeitura (falta de material, outra equipe, reagendamento, troca de equipe, revisão de fotos, ajuste pedido) nunca chegam a ele.
2. **O agente só é interrompido por trabalho:** serviço novo para a equipe e ajuste pedido.
3. **O gestor tem um sino no painel**, com o texto do aviso variando conforme o que aconteceu, nunca fixo. Clicar leva ao lugar onde ele vê o que mudou.

## 2. Objetivos, não-objetivos e antiobjetivos

**Objetivos**

- Push ao cidadão e ao agente nos eventos da seção 4, com envio simulado enquanto Firebase e Apple não estão configurados.
- Sino de avisos no painel (seção 5).
- E-mail ao cidadão quando o serviço é concluído e ele precisa confirmar.
- Confirmação automática da solicitação depois de 7 dias aguardando o cidadão.
- Correções do push que já existe (seção 7).

**Não-objetivos (ficam para depois)**

- Configurar Firebase e a conta Apple e testar a entrega real (decisão do usuário de 23/10: no fim, junto com aparelhos reais).
- Caixa de avisos dentro do app do cidadão ou do agente. Tocar no push abre a solicitação ou o serviço; a lista de solicitações já mostra a situação (minha decisão; o planejamento falava em caixa de entrada, mas as telas do app não têm).
- Preferências de aviso (desligar tipos de aviso, horário de silêncio).
- Avisos à equipe Alô Cidadão no backoffice.
- Aviso instantâneo no painel (WebSocket); o sino se atualiza sozinho de tempos em tempos.

**Antiobjetivos — seria falha mesmo funcionando**

- Dado pessoal (nome, endereço, descrição, tipo de problema) no conteúdo do push. O push leva só o protocolo e a situação (regra do planejamento), porque aparece na tela bloqueada.
- O cidadão receber aviso de passo interno da prefeitura.
- Alguém receber aviso de outra prefeitura, ou de solicitação que não é dele, ou de setor que não gere.
- A mesma pessoa receber o mesmo aviso duas vezes (nova tentativa, dois aparelhos do mesmo token).
- Um erro do push (FCM fora do ar, token inválido) desfazer ou travar a ação que o gerou.
- Aviso de algo que a própria pessoa acabou de fazer.

## 3. Conteúdo do aviso

- **Push:** título `Alô Cidadão`; corpo `Solicitação {protocolo}: {o que aconteceu}` para o cidadão, e o equivalente com o protocolo para o agente. Nenhum outro dado. Os dados escondidos do push levam só o necessário para abrir a tela certa (ids e o tipo do aviso).
- **Sino:** o mesmo formato, com a hora relativa ("há 5 min").
- Os textos finais vão para o usuário aprovar antes do código (regra do projeto). Os exemplos abaixo são rascunho.

## 4. Push

### Cidadão (dono da solicitação)

**Regra:** toda mudança de situação da solicitação dele que ele não causou, exceto a confirmação automática. A tabela mostra os casos que existem hoje, inclusive os caminhos menos óbvios:

| Mudança                                                                         | Rascunho do texto                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------- |
| Aberta → Em atendimento (aceita e encaminhada a uma equipe)                     | `Solicitação {p}: em atendimento`                 |
| Aberta → Em atendimento por junção com uma ocorrência que já tem equipe         | `Solicitação {p}: em atendimento`                 |
| Aberta ou Em atendimento → Recusada (inclusive recusa depois de um impedimento) | `Solicitação {p}: recusada. Veja o motivo no app` |
| → Aguardando confirmação (prefeitura publicou a conclusão)                      | `Solicitação {p}: concluída. Confira as fotos`    |
| Aguardando confirmação → Aberta porque **outro** morador contestou              | `Solicitação {p}: voltou para análise`            |

- Sem aviso: quando o cidadão cria, cancela, confirma ou contesta (foi ele); na confirmação automática dos 7 dias (já foi avisado na conclusão); em qualquer passo interno.
- O nome da equipe não vai no aviso.
- **E-mail** só na conclusão (aguardando confirmação), se o cidadão tem e-mail, com o mesmo conteúdo e o lembrete dos 7 dias (do planejamento). Sem dado pessoal além do protocolo.

### Agente

Para todos os agentes ativos da equipe (minha decisão; a alternativa seria só quem executou):

| Evento                                                                | Rascunho do texto     |
| --------------------------------------------------------------------- | --------------------- |
| Serviço atribuído à equipe (atribuição, ou repassado de outra equipe) | `Nova atividade: {p}` |
| Gestor devolveu pedindo ajuste                                        | `Ajuste pedido: {p}`  |

- Sem aviso: reagendamento, cancelamento, serviço tirado da equipe. A ação offline sobre serviço que saiu da equipe já é recusada com explicação (Plano 4).
- Tocar abre o serviço no modo agente; se a pessoa está no modo cidadão ou em outra prefeitura, o app troca para o lugar certo (detalhe para o plano).

## 5. Sino do painel

- **Onde:** no topo de todas as telas do painel da prefeitura, com o número de não lidos. Clicar abre a lista dos mais recentes; cada item tem protocolo, o que aconteceu e quando. Clicar num item marca como lido e leva à solicitação ou ao item da fila correspondente. "Marcar todos como lidos" (minha decisão).
- **Quem recebe:** os gestores do setor da categoria da solicitação; o admin da prefeitura recebe todos (minha decisão, aceita pelo usuário). Cada pessoa tem seus lidos e não lidos.
- **Eventos (decisão do usuário: estes cinco, avaliar depois):**

| Evento                              | Rascunho do texto                                               | Leva a            |
| ----------------------------------- | --------------------------------------------------------------- | ----------------- |
| Agente concluiu (com ou sem fotos)  | `Solicitação {p}: concluída com fotos` ou `concluída sem fotos` | revisão (W3)      |
| Agente registrou impedimento        | `Solicitação {p}: impedimento registrado`                       | impedimentos (W4) |
| Cidadão contestou a conclusão       | `Solicitação {p}: contestada pelo cidadão`                      | a ocorrência      |
| Ocorrência nova chegou para análise | `Solicitação {p}: nova, aguardando análise`                     | triagem           |
| Cidadão cancelou                    | `Solicitação {p}: cancelada pelo cidadão`                       | a ocorrência      |

- **"Nova, aguardando análise"** só quando nasce uma ocorrência nova na triagem. Outro morador que apoia uma ocorrência que já está na fila (ou já em atendimento) não gera aviso, para o sino não encher num ponto movimentado (minha decisão).
- **Sem e-mail ao gestor:** o sino substitui os e-mails de impedimento e de contestação que o planejamento previa (minha decisão, pela escolha do usuário de avisar o gestor no painel).
- **Atualização:** a lista se atualiza sozinha a cada minuto, mais ou menos, e ao voltar para a aba (minha decisão).
- **Sem aviso de si mesmo:** quem fez a ação não recebe o aviso dela (gestor que também atua não se avisa).
- **Modo suporte:** a equipe Alô Cidadão em modo suporte não recebe nem marca avisos como lidos (minha decisão).
- **Guardar:** 90 dias (minha decisão).
- **Pencil:** o sino e a lista são telas novas. Seguem a regra do projeto: desenhados no Pencil e aprovados pelo usuário antes do código (junto do desenho do 6b, em 31/10; se ficar pronto antes, o usuário valida no sistema rodando). O backend e os avisos do app não esperam por isso.

## 6. Confirmação automática

- Solicitação em "Aguardando confirmação" há 7 dias (`AUTO_CONFIRM_AFTER_DAYS`) vira "Concluída" sozinha, com evento próprio na linha do tempo (sem pessoa como autor). Quando todas as solicitações da ocorrência estão concluídas, a ocorrência também fica concluída, como na confirmação feita pelo cidadão.
- Roda periodicamente na API (frequência e mecanismo ficam para o plano), é segura se duas instâncias rodarem juntas e não gera push.

## 7. Correções do push (pendências do Plano 7)

- FCM: só tratar como token inválido os erros que dizem isso (`UNREGISTERED`, token mal formado), não todo `INVALID_ARGUMENT`; um erro de conteúdo não pode apagar tokens.
- O mesmo token em duas contas: ao registrar o token num aparelho, ele sai dos outros registros (outra conta que usou o mesmo aparelho deixa de receber).
- APNs e HTTP/2: reaproveitar a sessão com teste; fechar sessão com GOAWAY; token com `encodeURIComponent`; `DeviceTokenNotForTopic` como token inválido; bundle id pela configuração; `.p8` ausente não derruba a subida (push fica desligado, como sem FCM).
- `app.config.ts` com `__dirname` em vez de `process.cwd()`.

## 8. Como os envios acontecem

- Os avisos nascem na mesma transação da mudança que os causa (do planejamento: "fila no backend"), para nunca haver mudança sem aviso nem aviso sem mudança. O envio acontece depois, fora da transação, com nova tentativa e descarte de tokens inválidos.
- Sem FCM/APNs configurados, o envio é simulado: registrado no log da API, para o desenvolvimento e a passada no navegador. Nada muda no código quando as contas forem configuradas, só as variáveis de ambiente.
- Uma pessoa com vários aparelhos recebe em todos.
- Sair da conta no app (logout) tira o token de push daquele aparelho: um celular deslogado não mostra protocolos de ninguém (minha decisão).

## 9. Deixado para quem implementa

- Formato da fila de envio, do trabalho periódico e da tabela de avisos do painel.
- Como os eventos viram avisos (a partir de `status_events` ou nas funções de mudança), desde que na mesma transação.
- Número de tentativas e intervalos.
- Quantos avisos a lista do sino mostra e se tem paginação.
- Os textos finais (vão para o usuário aprovar).
