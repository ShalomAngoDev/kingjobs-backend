import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminAuditAction,
  MissionRejectionReason,
  MissionReviewChangeArea,
  MissionStatus,
  type Mission,
  type Prisma,
} from '@prisma/client';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildMissionReviewEmail } from './mission-emails';
import { MissionLifecycleService } from './mission-lifecycle.service';
import { assertMissionReadyForReview } from './mission-readiness';

export type ApproveMissionInput = {
  missionId: string;
  adminUserId: string;
  internalNote?: string | null;
};

export type RequestMissionChangesInput = {
  missionId: string;
  adminUserId: string;
  message: string;
  areas: MissionReviewChangeArea[];
  internalNote?: string | null;
};

export type RejectMissionInput = {
  missionId: string;
  adminUserId: string;
  reasonCode: MissionRejectionReason;
  reasonText: string;
  internalNote?: string | null;
};

@Injectable()
export class MissionReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MissionLifecycleService,
    private readonly email: EmailService,
  ) {}

  async approve(input: ApproveMissionInput): Promise<Mission> {
    const mission = await this.requirePendingReview(input.missionId);
    await assertMissionReadyForReview(this.prisma, mission);

    const updated = await this.lifecycle.approveForPublication(
      mission.id,
      input.adminUserId,
      input.internalNote,
    );

    await this.audit(input.adminUserId, AdminAuditAction.APPROVE_MISSION, {
      missionId: mission.id,
    });

    await this.notifyClient(updated, 'approved');
    return updated;
  }

  async requestChanges(input: RequestMissionChangesInput): Promise<Mission> {
    const mission = await this.requirePendingReview(input.missionId);
    const message = input.message.trim();
    if (!message) {
      throw new ConflictException('Le message au Client est obligatoire.');
    }
    if (input.areas.length === 0) {
      throw new ConflictException(
        'Sélectionnez au moins un élément à corriger.',
      );
    }

    const updated = await this.lifecycle.requestMissionChanges(
      mission.id,
      input.adminUserId,
      {
        message,
        areas: input.areas,
        internalNote: input.internalNote?.trim() || null,
      },
    );

    await this.audit(
      input.adminUserId,
      AdminAuditAction.REQUEST_MISSION_CHANGES,
      { missionId: mission.id, areas: input.areas },
    );

    await this.notifyClient(updated, 'needs_changes', message);
    return updated;
  }

  async reject(input: RejectMissionInput): Promise<Mission> {
    const mission = await this.requirePendingReview(input.missionId);
    const reasonText = input.reasonText.trim();
    if (!reasonText) {
      throw new ConflictException('Le motif de refus est obligatoire.');
    }

    const updated = await this.lifecycle.rejectMission(
      mission.id,
      input.adminUserId,
      {
        reasonCode: input.reasonCode,
        reasonText,
        internalNote: input.internalNote?.trim() || null,
        financialFollowUp: Boolean(mission.paymentConfirmedAt),
      },
    );

    await this.audit(input.adminUserId, AdminAuditAction.REJECT_MISSION, {
      missionId: mission.id,
      reasonCode: input.reasonCode,
    });

    await this.notifyClient(updated, 'rejected', reasonText);
    return updated;
  }

  async counts(): Promise<{ pendingReview: number }> {
    const pendingReview = await this.prisma.mission.count({
      where: { status: MissionStatus.PENDING_REVIEW },
    });
    return { pendingReview };
  }

  private async requirePendingReview(missionId: string): Promise<Mission> {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.status !== MissionStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Action impossible : la mission est ${mission.status}, pas PENDING_REVIEW.`,
      );
    }
    return mission;
  }

  private async audit(
    adminUserId: string,
    action: AdminAuditAction,
    metadata: Prisma.InputJsonObject & { missionId?: string },
  ) {
    const missionId =
      typeof metadata.missionId === 'string' ? metadata.missionId : 'unknown';
    await this.prisma.adminAuditEvent.create({
      data: {
        actorId: adminUserId,
        action,
        resourceType: 'mission',
        resourceId: missionId,
        metadata,
      },
    });
  }

  private async notifyClient(
    mission: Mission,
    kind: 'approved' | 'needs_changes' | 'rejected',
    userMessage?: string,
  ) {
    const client = await this.prisma.user.findUnique({
      where: { id: mission.clientUserId },
      select: { email: true, firstName: true },
    });
    if (!client?.email) {
      return;
    }
    const payload = buildMissionReviewEmail({
      kind,
      firstName: client.firstName,
      missionTitle: mission.title,
      userMessage,
      paymentConfirmed: Boolean(mission.paymentConfirmedAt),
    });
    await this.email.send({
      to: client.email,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
  }
}
