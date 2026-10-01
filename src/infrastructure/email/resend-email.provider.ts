import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import type { EmailProvider, SendEmailInput } from './email.types';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(input: SendEmailInput): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      this.logger.error(`Resend error: ${error.message}`);
      throw new Error(`Échec d'envoi email: ${error.message}`);
    }
  }
}
