import { Module } from '@nestjs/common';
import { EmailModule } from '../../infrastructure/email/email.module';
import { PaymentInfrastructureModule } from '../../infrastructure/payments/payment.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { AdminMissionsController } from './admin-missions.controller';
import { JobberMissionsController } from './jobber-missions.controller';
import { MissionApplicationsController } from './mission-applications.controller';
import { MissionApplicationsService } from './mission-applications.service';
import { MissionIncidentsService } from './mission-incidents.service';
import { MissionLifecycleService } from './mission-lifecycle.service';
import { MissionReviewService } from './mission-review.service';
import { MissionVerificationService } from './mission-verification.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

@Module({
  imports: [
    EligibilityModule,
    EmailModule,
    StorageModule,
    NotificationsModule,
    PaymentInfrastructureModule,
  ],
  // Ordre important : routes payment avant GET :id pour éviter tout conflit.
  controllers: [
    JobberMissionsController,
    MissionApplicationsController,
    PaymentsController,
    MissionsController,
    AdminMissionsController,
  ],
  providers: [
    MissionsService,
    MissionLifecycleService,
    MissionApplicationsService,
    MissionVerificationService,
    MissionIncidentsService,
    MissionReviewService,
    PaymentsService,
  ],
  // markPaymentConfirmed reste interne : exporté pour Payment / tests, jamais exposé en HTTP.
  exports: [MissionsService, MissionLifecycleService, PaymentsService],
})
export class MissionsModule {}
