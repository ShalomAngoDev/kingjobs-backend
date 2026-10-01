export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Jeton / lien sensible — jamais loggé en production. */
  debugToken?: string;
};

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
