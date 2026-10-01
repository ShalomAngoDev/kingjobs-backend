import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SendSmsInput, SmsProvider } from './sms.types';

@Injectable()
export class UnavailableSmsProvider implements SmsProvider {
  send(input: SendSmsInput): Promise<void> {
    void input;
    return Promise.reject(
      new ServiceUnavailableException(
        'Envoi SMS indisponible : aucun fournisseur SMS configuré',
      ),
    );
  }
}
