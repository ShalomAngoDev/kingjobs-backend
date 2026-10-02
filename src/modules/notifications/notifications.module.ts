import { Module } from '@nestjs/common';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [MeNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
