import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('clients')
@ApiBearerAuth()
@Controller({ path: 'clients', version: '1' })
export class ClientsController {
  constructor(private readonly authService: AuthService) {}

  @Post('me/activate')
  @ApiOperation({
    summary:
      'Activer le profil Client sur le compte existant (lazy, idempotent)',
  })
  activate(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.activateClient(user.id);
  }
}
