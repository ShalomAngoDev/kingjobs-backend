import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminVerificationsController } from './admin-verifications.controller';
import { IdentityCompletionService } from './identity-completion.service';
import { MeVerificationController } from './me-verification.controller';
import { VerificationsService } from './verifications.service';

@Module({
  imports: [StorageModule, EligibilityModule, NotificationsModule],
  controllers: [MeVerificationController, AdminVerificationsController],
  providers: [VerificationsService, IdentityCompletionService],
  exports: [VerificationsService, IdentityCompletionService],
})
export class VerificationsModule {}
