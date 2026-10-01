import { Inject, Injectable } from '@nestjs/common';
import { SMS_PROVIDER, type SendSmsInput, type SmsProvider } from './sms.types';

@Injectable()
export class SmsService {
  constructor(@Inject(SMS_PROVIDER) private readonly provider: SmsProvider) {}

  send(input: SendSmsInput): Promise<void> {
    return this.provider.send(input);
  }
}
