import { Injectable, Logger } from '@nestjs/common';
import type { SendSmsInput, SmsProvider } from './sms.types';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  constructor(private readonly nodeEnv: string) {}

  send(input: SendSmsInput): Promise<void> {
    const isProd = this.nodeEnv === 'production';
    if (isProd) {
      this.logger.log(`sms would send to=${input.to}`);
      return Promise.resolve();
    }
    const codeHint = input.debugCode ? ` debugCode=${input.debugCode}` : '';
    this.logger.log(`sms would send to=${input.to}${codeHint}`);
    return Promise.resolve();
  }
}
