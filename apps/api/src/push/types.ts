export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushResult =
  { kind: 'sent' } | { kind: 'invalid_token' } | { kind: 'retry'; reason: string };

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushResult>;
}
