import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, SendEmailInput } from './email.types';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  constructor(private readonly nodeEnv: string) {}

  send(input: SendEmailInput): Promise<void> {
    const isProd = this.nodeEnv === 'production';
    if (isProd) {
      this.logger.log(
        `email would send to=${input.to} subject=${input.subject}`,
      );
      return Promise.resolve();
    }

    const tokenHint = input.debugToken ? ` debugToken=${input.debugToken}` : '';
    this.logger.log(
      `email would send to=${input.to} subject=${input.subject}${tokenHint}`,
    );
    return Promise.resolve();
  }
}
