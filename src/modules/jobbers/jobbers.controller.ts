import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UpdateJobberMeDto } from './dto/update-jobber-me.dto';

@ApiTags('jobbers')
@ApiBearerAuth()
@Controller({ path: 'jobbers', version: '1' })
export class JobbersController {
  constructor(private readonly authService: AuthService) {}

  @Post('me/activate')
  @ApiOperation({ summary: 'Activer le profil Jobber sur le compte existant' })
  activate(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.activateJobber(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Profil Jobber courant' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getJobberMe(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour le profil Jobber (bio)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateJobberMeDto,
  ) {
    return this.authService.updateJobberMe(user.id, dto.bio);
  }
}
