import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PaymentsService } from './payments.service';

/**
 * Paiement Mission (Client).
 * Les routes `/payment/simulate-*` ne fonctionnent que si PAYMENT_PROVIDER=mock
 * et NODE_ENV ≠ production (fail-closed côté service).
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'missions', version: '1' })
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':id/payment')
  @ApiOperation({
    summary: 'Récapitulatif paiement Mission (montant Backend + mode simulation)',
  })
  getPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentsService.getMissionPaymentView(user.id, id);
  }

  @Post(':id/payment/simulate-success')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'DEV — Simuler un paiement réussi (MOCK uniquement)',
  })
  simulateSuccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentsService.simulateSuccess(user.id, id);
  }

  @Post(':id/payment/simulate-failure')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'DEV — Simuler un paiement échoué (MOCK uniquement)',
  })
  simulateFailure(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentsService.simulateFailure(user.id, id);
  }

  @Post(':id/payment/simulate-cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'DEV — Simuler une annulation de paiement (MOCK uniquement)',
  })
  simulateCancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentsService.simulateCancel(user.id, id);
  }
}
