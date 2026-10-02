import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module';

/**
 * Réexport pour AppModule.
 * Les routes HTTP payment sont montées dans MissionsModule
 * (préfixe /missions, ordre de routing garanti).
 */
@Module({
  imports: [MissionsModule],
  exports: [MissionsModule],
})
export class PaymentsModule {}
