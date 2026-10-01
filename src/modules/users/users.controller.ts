import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CloseAccountDto } from './dto/close-account.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil utilisateur courant' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getSafeUserById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour le profil' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(user.id, dto);
  }

  @Post('me/close')
  @ApiOperation({ summary: 'Fermer le compte (soft close)' })
  close(@CurrentUser() user: AuthenticatedUser, @Body() dto: CloseAccountDto) {
    return this.authService.closeAccount(user.id, dto.password);
  }
}
