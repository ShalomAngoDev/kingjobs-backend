import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  ListNotificationsQueryDto,
  MarkAllReadQueryDto,
  UnreadNotificationsQueryDto,
} from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class MeNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('me/notifications')
  @ApiOperation({
    summary: 'Mes notifications in-app (paginées, filtrables par espace)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.listForUser(
      user.id,
      query.limit ?? 20,
      query.page ?? 1,
      query.space,
    );
  }

  @Get('me/notifications/unread-count')
  @ApiOperation({
    summary: 'Nombre de notifications non lues (filtrable par espace)',
  })
  unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: UnreadNotificationsQueryDto,
  ) {
    return this.notifications.unreadCount(user.id, query.space);
  }

  @Post('me/notifications/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('me/notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marquer mes notifications comme lues (filtrable par espace)',
  })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarkAllReadQueryDto,
  ) {
    return this.notifications.markAllRead(user.id, query.space);
  }
}
