import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type SendEmailInput,
} from './email.types';

@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  send(input: SendEmailInput): Promise<void> {
    return this.provider.send(input);
  }
}
