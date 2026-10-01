export type SendSmsInput = {
  to: string;
  body: string;
  /** Code OTP — jamais loggé en production. */
  debugCode?: string;
};

export interface SmsProvider {
  send(input: SendSmsInput): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
