import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionActorType,
  MissionApplicationStatus,
  MissionAssignmentStatus,
  MissionRejectionReason,
  MissionReviewChangeArea,
  MissionStatus,
  type Mission,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CancelMissionDto } from './dto/cancel-mission.dto';
import { assertUserCanOperateAsClient } from '../verifications/operational-gates';
import {
  derivePricingFromMission,
  KINGJOBS_COMMISSION_BPS,
} from './mission-pricing';
import { computeMinimumAge } from './mission-rules';
import { computeStaffing } from './mission-staffing';

export type Tx = Prisma.TransactionClient;

/**
 * Machine à états explicite des missions.
 * Aucune route ne permet de PATCH le status : seules les méthodes de
 * MissionLifecycleService appliquent ces transitions.
 */
export const MISSION_TRANSITIONS: Readonly<
  Record<MissionStatus, readonly MissionStatus[]>
> = {
  [MissionStatus.DRAFT]: [MissionStatus.PAYMENT_REQUIRED, MissionStatus.CANCELLED],
  [MissionStatus.PAYMENT_REQUIRED]: [
    MissionStatus.PENDING_REVIEW,
    MissionStatus.CONFIRMED,
    MissionStatus.CANCELLED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.PENDING_REVIEW]: [
    MissionStatus.PUBLISHED,
    MissionStatus.NEEDS_CHANGES,
    MissionStatus.REJECTED,
  ],
  [MissionStatus.NEEDS_CHANGES]: [
    MissionStatus.PENDING_REVIEW,
    MissionStatus.CANCELLED,
  ],
  [MissionStatus.REJECTED]: [],
  [MissionStatus.PUBLISHED]: [
    MissionStatus.APPLICATION_SELECTED,
    MissionStatus.CANCELLED,
  ],
  [MissionStatus.APPLICATION_SELECTED]: [
    MissionStatus.PAYMENT_REQUIRED,
    MissionStatus.CONFIRMED,
    MissionStatus.PUBLISHED,
    MissionStatus.CANCELLED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.CONFIRMED]: [
    MissionStatus.READY_TO_START,
    MissionStatus.IN_PROGRESS,
    MissionStatus.PUBLISHED,
    MissionStatus.CANCELLED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.READY_TO_START]: [
    MissionStatus.IN_PROGRESS,
    MissionStatus.CANCELLED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.IN_PROGRESS]: [
    MissionStatus.COMPLETION_PENDING,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.COMPLETION_PENDING]: [
    MissionStatus.COMPLETED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.COMPLETED]: [],
  [MissionStatus.CANCELLED]: [],
  // Sortie de litige réservée à la résolution admin (Backend 05) — aucun endpoint ici.
  [MissionStatus.DISPUTED]: [MissionStatus.CANCELLED, MissionStatus.COMPLETED],
};

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MissionStatus, to: MissionStatus) {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      `Transition de statut interdite : ${from} → ${to}`,
    );
  }
}

/** Statuts dans lesquels le Client peut annuler. */
const CLIENT_CANCELLABLE: ReadonlySet<MissionStatus> = new Set([
  MissionStatus.DRAFT,
  MissionStatus.PAYMENT_REQUIRED,
  MissionStatus.PENDING_REVIEW,
  MissionStatus.NEEDS_CHANGES,
  MissionStatus.PUBLISHED,
  MissionStatus.APPLICATION_SELECTED,
  MissionStatus.CONFIRMED,
  MissionStatus.READY_TO_START,
]);

/** Statuts dans lesquels le Jobber sélectionné peut annuler (après sélection, avant démarrage). */
const JOBBER_CANCELLABLE: ReadonlySet<MissionStatus> = new Set([
  MissionStatus.APPLICATION_SELECTED,
  MissionStatus.PAYMENT_REQUIRED,
  MissionStatus.CONFIRMED,
  MissionStatus.READY_TO_START,
]);

type TransitionInput = {
  mission: Pick<Mission, 'id' | 'status'>;
  to: MissionStatus;
  actorUserId?: string | null;
  actorType: MissionActorType;
  reason?: string;
  metadata?: Prisma.InputJsonObject;
  data?: Prisma.MissionUncheckedUpdateManyInput;
  /** Conditions supplémentaires du verrou optimiste (ex. selectedJobberUserId null). */
  where?: Prisma.MissionWhereInput;
};

@Injectable()
export class MissionLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Transitions publiques ----------

  /** DRAFT → PAYMENT_REQUIRED (soumission avant paiement publication). */
  async submitForPayment(
    missionId: string,
    clientUserId: string,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      this.assertOwner(mission, clientUserId);
      assertTransition(mission.status, MissionStatus.PAYMENT_REQUIRED);

      const client = await db.user.findUnique({
        where: { id: clientUserId },
        select: {
          status: true,
          identityVerificationStatus: true,
          legalGuardianStatus: true,
        },
      });
      assertUserCanOperateAsClient(client);

      await this.applyTransition(db, {
        mission,
        to: MissionStatus.PAYMENT_REQUIRED,
        actorUserId: clientUserId,
        actorType: MissionActorType.CLIENT,
        where: { clientUserId },
        reason: 'Soumission pour paiement',
      });
      return this.reload(db, missionId);
    });
  }

  /** NEEDS_CHANGES → PENDING_REVIEW (sans repaiement). */
  async resubmitForReview(
    missionId: string,
    clientUserId: string,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      this.assertOwner(mission, clientUserId);
      assertTransition(mission.status, MissionStatus.PENDING_REVIEW);

      const client = await db.user.findUnique({
        where: { id: clientUserId },
        select: {
          status: true,
          identityVerificationStatus: true,
          legalGuardianStatus: true,
        },
      });
      assertUserCanOperateAsClient(client);

      await this.applyTransition(db, {
        mission,
        to: MissionStatus.PENDING_REVIEW,
        actorUserId: clientUserId,
        actorType: MissionActorType.CLIENT,
        where: { clientUserId },
        reason: 'Resoumission après corrections',
        data: {
          submittedForReviewAt: new Date(),
          clientReviewMessage: null,
          reviewChangeAreas: [],
        },
      });
      return this.reload(db, missionId);
    });
  }

  /** PENDING_REVIEW → PUBLISHED (décision Admin). */
  async approveForPublication(
    missionId: string,
    adminUserId: string,
    internalNote?: string | null,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.PUBLISHED);

      const service = await db.service.findUnique({
        where: { id: mission.serviceId },
        include: { category: true },
      });
      if (!service || !service.isActive || !service.category.isActive) {
        throw new ConflictException(
          'Ce service n’est plus disponible : la mission ne peut pas être publiée.',
        );
      }
      if (mission.scheduledStartAt && mission.scheduledStartAt <= new Date()) {
        throw new ConflictException(
          'La date de début prévue est passée : modifiez-la avant publication.',
        );
      }

      await this.applyTransition(db, {
        mission,
        to: MissionStatus.PUBLISHED,
        actorUserId: adminUserId,
        actorType: MissionActorType.ADMIN,
        data: {
          publishedAt: new Date(),
          serviceNameSnapshot: service.name,
          serviceSlugSnapshot: service.slug,
          categoryNameSnapshot: service.category.name,
          categorySlugSnapshot: service.category.slug,
          minimumAge: computeMinimumAge(service.minimumAge, mission.riskFlags),
          reviewInternalNote: internalNote?.trim() || mission.reviewInternalNote,
        },
      });
      return this.reload(db, missionId);
    });
  }

  async requestMissionChanges(
    missionId: string,
    adminUserId: string,
    input: {
      message: string;
      areas: MissionReviewChangeArea[];
      internalNote?: string | null;
    },
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.NEEDS_CHANGES);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.NEEDS_CHANGES,
        actorUserId: adminUserId,
        actorType: MissionActorType.ADMIN,
        reason: input.message,
        metadata: { areas: input.areas },
        data: {
          clientReviewMessage: input.message,
          reviewChangeAreas: input.areas,
          reviewInternalNote:
            input.internalNote?.trim() || mission.reviewInternalNote,
        },
      });
      return this.reload(db, missionId);
    });
  }

  async rejectMission(
    missionId: string,
    adminUserId: string,
    input: {
      reasonCode: MissionRejectionReason;
      reasonText: string;
      internalNote?: string | null;
      financialFollowUp: boolean;
    },
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.REJECTED);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.REJECTED,
        actorUserId: adminUserId,
        actorType: MissionActorType.ADMIN,
        reason: input.reasonText,
        metadata: { reasonCode: input.reasonCode },
        data: {
          rejectionReasonCode: input.reasonCode,
          rejectionReasonText: input.reasonText,
          reviewInternalNote:
            input.internalNote?.trim() || mission.reviewInternalNote,
          financialFollowUpRequired: input.financialFollowUp,
        },
      });
      return this.reload(db, missionId);
    });
  }

  /**
   * Sélection multi-Jobber (BO05).
   * - Crée MissionAssignment ACTIVE + snapshot financier.
   * - Mission reste PUBLISHED tant qu'il reste des places.
   * - Dernière place : clôture PENDING → MISSION_FILLED, puis PUBLISHED → APPLICATION_SELECTED → CONFIRMED
   *   (paiement publication déjà fait ; JAMAIS PAYMENT_REQUIRED post-sélection BO04+).
   * - Concurrence : SELECT FOR UPDATE + partial unique index ACTIVE.
   * - Idempotence : re-select d'une candidature déjà SELECTED avec assignment ACTIVE → no-op.
   */
  async selectApplication(
    missionId: string,
    applicationId: string,
    clientUserId: string,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      await db.$executeRaw`
        SELECT id FROM missions WHERE id = ${missionId}::uuid FOR UPDATE
      `;

      const mission = await this.load(db, missionId);
      this.assertOwner(mission, clientUserId);

      if (mission.status !== MissionStatus.PUBLISHED) {
        throw new ConflictException(
          'Un Jobber ne peut être sélectionné que sur une mission publiée en recrutement.',
        );
      }

      const application = await db.missionApplication.findUnique({
        where: { id: applicationId },
        include: { assignment: true },
      });
      if (!application || application.missionId !== missionId) {
        throw new NotFoundException('Candidature introuvable');
      }

      // Idempotence : déjà sélectionné avec affectation active.
      if (
        application.status === MissionApplicationStatus.SELECTED &&
        application.assignment?.status === MissionAssignmentStatus.ACTIVE
      ) {
        return this.reload(db, missionId);
      }

      if (application.status !== MissionApplicationStatus.PENDING) {
        throw new ConflictException(
          'Cette candidature n’est plus sélectionnable.',
        );
      }

      const activeCount = await db.missionAssignment.count({
        where: { missionId, status: MissionAssignmentStatus.ACTIVE },
      });
      const staffing = computeStaffing(mission.workersNeeded, activeCount);
      if (staffing.isFull) {
        throw new ConflictException(
          'Toutes les places de cette mission sont déjà pourvues.',
        );
      }

      const existingActiveForJobber = await db.missionAssignment.findFirst({
        where: {
          missionId,
          jobberUserId: application.jobberUserId,
          status: MissionAssignmentStatus.ACTIVE,
        },
      });
      if (existingActiveForJobber) {
        throw new ConflictException(
          'Ce Jobber est déjà affecté à cette mission.',
        );
      }

      const now = new Date();
      let workerGrossAmount = mission.clientPriceAmount;
      try {
        workerGrossAmount = derivePricingFromMission({
          pricingType: mission.pricingType,
          rateAmount: mission.rateAmount,
          rateScope: mission.rateScope,
          clientPriceAmount: mission.clientPriceAmount,
          estimatedAmount: mission.estimatedAmount,
          workersNeeded: mission.workersNeeded,
          estimatedDurationMinutes: mission.estimatedDurationMinutes,
          durationKnown: mission.durationKnown,
          schedulingType: mission.schedulingType,
        }).workerGrossAmount;
      } catch {
        // Snapshot best-effort : total / workers si divisible.
        if (
          mission.workersNeeded > 1 &&
          mission.clientPriceAmount % mission.workersNeeded === 0
        ) {
          workerGrossAmount =
            mission.clientPriceAmount / mission.workersNeeded;
        }
      }

      const selected = await db.missionApplication.updateMany({
        where: {
          id: applicationId,
          missionId,
          status: MissionApplicationStatus.PENDING,
        },
        data: {
          status: MissionApplicationStatus.SELECTED,
          selectedAt: now,
        },
      });
      if (selected.count !== 1) {
        throw new ConflictException(
          'Cette candidature n’est plus disponible (retirée ?).',
        );
      }

      await db.missionAssignment.create({
        data: {
          missionId,
          jobberUserId: application.jobberUserId,
          applicationId,
          status: MissionAssignmentStatus.ACTIVE,
          selectedAt: now,
          selectedByUserId: clientUserId,
          workerGrossAmount,
          commissionRateBps: KINGJOBS_COMMISSION_BPS,
          currency: mission.currency,
        },
      });

      const newFilled = activeCount + 1;
      const afterStaffing = computeStaffing(mission.workersNeeded, newFilled);

      // Synchro legacy selectedJobberUserId (premier ACTIVE) pour START/END V1.
      if (!mission.selectedJobberUserId) {
        await db.mission.update({
          where: { id: missionId },
          data: {
            selectedJobberUserId: application.jobberUserId,
            assignedAt: mission.assignedAt ?? now,
          },
        });
      }

      if (!afterStaffing.isFull) {
        return this.reload(db, missionId);
      }

      // Mission pleine : clôturer les PENDING restants (pas un rejet personnel).
      await db.missionApplication.updateMany({
        where: {
          missionId,
          status: MissionApplicationStatus.PENDING,
        },
        data: {
          status: MissionApplicationStatus.MISSION_FILLED,
          closedAt: now,
        },
      });

      const current = await this.load(db, missionId);
      await this.applyTransition(db, {
        mission: current,
        to: MissionStatus.APPLICATION_SELECTED,
        actorUserId: clientUserId,
        actorType: MissionActorType.CLIENT,
        reason: 'Effectif Mission complet',
        metadata: {
          applicationId,
          filledWorkers: afterStaffing.filledWorkers,
          workersNeeded: afterStaffing.workersNeeded,
        },
        data: {
          assignedAt: current.assignedAt ?? now,
          selectedJobberUserId:
            current.selectedJobberUserId ?? application.jobberUserId,
        },
      });

      // BO04+ : paiement déjà confirmé avant PUBLISHED → CONFIRMED, jamais PAYMENT_REQUIRED.
      if (current.paymentConfirmedAt || current.publishedAt) {
        await this.applyTransition(db, {
          mission: {
            id: missionId,
            status: MissionStatus.APPLICATION_SELECTED,
          },
          to: MissionStatus.CONFIRMED,
          actorUserId: clientUserId,
          actorType: MissionActorType.SYSTEM,
          reason: 'Effectif complet (paiement publication déjà confirmé)',
          data: { confirmedAt: now },
        });
      } else {
        // Legacy rare : mission publiée sans paiement (ne devrait plus arriver).
        await this.applyTransition(db, {
          mission: {
            id: missionId,
            status: MissionStatus.APPLICATION_SELECTED,
          },
          to: MissionStatus.PAYMENT_REQUIRED,
          actorUserId: clientUserId,
          actorType: MissionActorType.SYSTEM,
          reason: 'Legacy : paiement post-sélection (mission sans paymentConfirmedAt)',
        });
      }

      return this.reload(db, missionId);
    });
  }

  /**
   * Annule une affectation ACTIVE (désistement Jobber ou annulation Client du slot).
   * Rouvre une place ; si la Mission était pleine (CONFIRMED/APPLICATION_SELECTED),
   * retour en PUBLISHED pour accepter de nouvelles candidatures.
   */
  async cancelAssignment(input: {
    missionId: string;
    assignmentId: string;
    actorUserId: string;
    reason?: string | null;
    asClient?: boolean;
    tx?: Tx;
  }): Promise<Mission> {
    return this.run(input.tx, async (db) => {
      await db.$executeRaw`
        SELECT id FROM missions WHERE id = ${input.missionId}::uuid FOR UPDATE
      `;

      const mission = await this.load(db, input.missionId);
      const assignment = await db.missionAssignment.findUnique({
        where: { id: input.assignmentId },
      });
      if (!assignment || assignment.missionId !== input.missionId) {
        throw new NotFoundException('Affectation introuvable');
      }
      if (assignment.status !== MissionAssignmentStatus.ACTIVE) {
        throw new ConflictException('Cette affectation n’est plus active.');
      }

      const isClient = mission.clientUserId === input.actorUserId;
      const isJobber = assignment.jobberUserId === input.actorUserId;
      if (input.asClient) {
        if (!isClient) {
          throw new NotFoundException('Affectation introuvable');
        }
      } else if (!isJobber && !isClient) {
        throw new NotFoundException('Affectation introuvable');
      }

      const cancellableMission =
        mission.status === MissionStatus.PUBLISHED ||
        mission.status === MissionStatus.APPLICATION_SELECTED ||
        mission.status === MissionStatus.CONFIRMED ||
        mission.status === MissionStatus.READY_TO_START ||
        mission.status === MissionStatus.PAYMENT_REQUIRED;
      if (!cancellableMission) {
        throw new ConflictException(
          'Cette affectation ne peut plus être annulée à ce stade.',
        );
      }

      const now = new Date();
      const cancelled = await db.missionAssignment.updateMany({
        where: {
          id: assignment.id,
          status: MissionAssignmentStatus.ACTIVE,
        },
        data: {
          status: MissionAssignmentStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: input.reason?.trim() || null,
        },
      });
      if (cancelled.count !== 1) {
        throw new ConflictException('Cette affectation n’est plus active.');
      }

      await db.missionApplication.updateMany({
        where: { id: assignment.applicationId },
        data: {
          status: MissionApplicationStatus.ASSIGNMENT_CANCELLED,
          closedAt: now,
        },
      });

      const remainingActive = await db.missionAssignment.findMany({
        where: { missionId: input.missionId, status: MissionAssignmentStatus.ACTIVE },
        orderBy: { selectedAt: 'asc' },
        select: { jobberUserId: true },
      });

      await db.mission.update({
        where: { id: input.missionId },
        data: {
          selectedJobberUserId: remainingActive[0]?.jobberUserId ?? null,
          assignedAt: remainingActive.length > 0 ? mission.assignedAt : null,
        },
      });

      // Rouvrir le recrutement si une place s'est libérée après remplissage.
      if (
        (mission.status === MissionStatus.APPLICATION_SELECTED ||
          mission.status === MissionStatus.CONFIRMED) &&
        remainingActive.length < mission.workersNeeded
      ) {
        await this.applyTransition(db, {
          mission,
          to: MissionStatus.PUBLISHED,
          actorUserId: input.actorUserId,
          actorType: isClient
            ? MissionActorType.CLIENT
            : MissionActorType.JOBBER,
          reason: 'Place libérée après annulation d’affectation',
          metadata: {
            assignmentId: assignment.id,
            remainingWorkers:
              mission.workersNeeded - remainingActive.length,
          },
          data: { confirmedAt: null },
        });
      }

      return this.reload(db, input.missionId);
    });
  }

  /** Client : refuse une candidature PENDING (pas une affectation). */
  async rejectApplication(
    missionId: string,
    applicationId: string,
    clientUserId: string,
    tx?: Tx,
  ): Promise<void> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      this.assertOwner(mission, clientUserId);

      const application = await db.missionApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application || application.missionId !== missionId) {
        throw new NotFoundException('Candidature introuvable');
      }
      if (application.status !== MissionApplicationStatus.PENDING) {
        throw new ConflictException(
          'Seule une candidature en attente peut être refusée.',
        );
      }

      const now = new Date();
      const updated = await db.missionApplication.updateMany({
        where: {
          id: applicationId,
          status: MissionApplicationStatus.PENDING,
        },
        data: {
          status: MissionApplicationStatus.REJECTED,
          rejectedAt: now,
          closedAt: now,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Cette candidature ne peut plus être refusée.',
        );
      }
    });
  }

  /**
   * Paiement confirmé (interne uniquement, Backend Payment / tests).
   * - Publication (publishedAt null) : PAYMENT_REQUIRED → PENDING_REVIEW.
   * - Legacy post-sélection (publishedAt défini) : PAYMENT_REQUIRED → CONFIRMED.
   */
  async markPaymentConfirmed(
    missionId: string,
    actorUserId?: string | null,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      if (mission.status !== MissionStatus.PAYMENT_REQUIRED) {
        throw new ConflictException(
          'Paiement confirmable uniquement depuis PAYMENT_REQUIRED.',
        );
      }
      const now = new Date();
      if (mission.publishedAt) {
        assertTransition(mission.status, MissionStatus.CONFIRMED);
        await this.applyTransition(db, {
          mission,
          to: MissionStatus.CONFIRMED,
          actorUserId: actorUserId ?? null,
          actorType: MissionActorType.SYSTEM,
          reason: 'Paiement confirmé (legacy post-sélection)',
          data: { confirmedAt: now, paymentConfirmedAt: now },
        });
      } else {
        assertTransition(mission.status, MissionStatus.PENDING_REVIEW);
        await this.applyTransition(db, {
          mission,
          to: MissionStatus.PENDING_REVIEW,
          actorUserId: actorUserId ?? null,
          actorType: MissionActorType.SYSTEM,
          reason: 'Paiement publication confirmé',
          data: {
            paymentConfirmedAt: now,
            submittedForReviewAt: now,
          },
        });
      }
      return this.reload(db, missionId);
    });
  }

  /** CONFIRMED → READY_TO_START (usage interne / futur planificateur). */
  async markReadyToStart(
    missionId: string,
    actorUserId?: string | null,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.READY_TO_START);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.READY_TO_START,
        actorUserId: actorUserId ?? null,
        actorType: MissionActorType.SYSTEM,
      });
      return this.reload(db, missionId);
    });
  }

  /** CONFIRMED | READY_TO_START → IN_PROGRESS (après validation du code/QR de début). */
  async startMission(
    missionId: string,
    actorUserId: string | null,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.IN_PROGRESS);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.IN_PROGRESS,
        actorUserId,
        actorType: MissionActorType.JOBBER,
        reason: 'Début validé par code/QR',
        data: { startedAt: new Date() },
      });
      return this.reload(db, missionId);
    });
  }

  /** IN_PROGRESS → COMPLETION_PENDING, uniquement par le Jobber sélectionné. */
  async requestCompletion(
    missionId: string,
    jobberUserId: string,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      if (mission.clientUserId === jobberUserId) {
        throw new ForbiddenException(
          'Seul un Jobber affecté peut demander la clôture.',
        );
      }
      const assignment = await db.missionAssignment.findFirst({
        where: {
          missionId,
          jobberUserId,
          status: MissionAssignmentStatus.ACTIVE,
        },
      });
      if (!assignment) {
        throw new NotFoundException('Mission introuvable');
      }
      assertTransition(mission.status, MissionStatus.COMPLETION_PENDING);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.COMPLETION_PENDING,
        actorUserId: jobberUserId,
        actorType: MissionActorType.JOBBER,
        data: { completionRequestedAt: new Date() },
      });
      return this.reload(db, missionId);
    });
  }

  /** COMPLETION_PENDING → COMPLETED (après validation du code/QR de fin). */
  async completeMission(
    missionId: string,
    actorUserId: string | null,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.COMPLETED);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.COMPLETED,
        actorUserId,
        actorType: MissionActorType.JOBBER,
        reason: 'Fin validée par code/QR',
        data: { completedAt: new Date() },
      });
      return this.reload(db, missionId);
    });
  }

  /**
   * Annulation par le Client propriétaire ou le Jobber sélectionné.
   * - Client : DRAFT … READY_TO_START.
   * - Jobber : seulement après sélection et avant démarrage.
   * Une mission IN_PROGRESS ou plus loin passe par un incident / litige, pas par l'annulation.
   */
  async cancel(
    missionId: string,
    actorUserId: string,
    dto: CancelMissionDto,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      const isClient = mission.clientUserId === actorUserId;
      const jobberAssignment = isClient
        ? null
        : await db.missionAssignment.findFirst({
            where: {
              missionId,
              jobberUserId: actorUserId,
              status: MissionAssignmentStatus.ACTIVE,
            },
          });
      const isJobber = Boolean(jobberAssignment);
      if (!isClient && !isJobber) {
        throw new NotFoundException('Mission introuvable');
      }

      // Multi-Jobber : un Jobber annule son slot, pas toute la Mission.
      if (isJobber && mission.workersNeeded > 1 && jobberAssignment) {
        throw new ConflictException(
          'Pour vous désister, annulez votre affectation (pas toute la mission).',
        );
      }

      const allowed = isClient ? CLIENT_CANCELLABLE : JOBBER_CANCELLABLE;
      if (!allowed.has(mission.status)) {
        throw new ConflictException(
          `Annulation impossible lorsque la mission est ${mission.status}.`,
        );
      }
      assertTransition(mission.status, MissionStatus.CANCELLED);

      const actorType = isClient
        ? MissionActorType.CLIENT
        : MissionActorType.JOBBER;
      const now = new Date();

      await this.applyTransition(db, {
        mission,
        to: MissionStatus.CANCELLED,
        actorUserId,
        actorType,
        reason: dto.reasonCode,
        metadata: { reasonCode: dto.reasonCode },
        data: { cancelledAt: now },
      });

      await db.missionCancellation.create({
        data: {
          missionId,
          initiatedByUserId: actorUserId,
          actorType,
          reasonCode: dto.reasonCode,
          reasonText: dto.reasonText?.trim() || null,
          previousStatus: mission.status,
        },
      });

      await db.missionApplication.updateMany({
        where: { missionId, status: MissionApplicationStatus.PENDING },
        data: {
          status: MissionApplicationStatus.REJECTED,
          rejectedAt: now,
          closedAt: now,
        },
      });

      await db.missionAssignment.updateMany({
        where: { missionId, status: MissionAssignmentStatus.ACTIVE },
        data: {
          status: MissionAssignmentStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: `Mission cancelled: ${dto.reasonCode}`,
        },
      });

      await db.missionApplication.updateMany({
        where: {
          missionId,
          status: MissionApplicationStatus.SELECTED,
        },
        data: {
          status: MissionApplicationStatus.ASSIGNMENT_CANCELLED,
          closedAt: now,
        },
      });

      return this.reload(db, missionId);
    });
  }

  /** Bascule en litige (incident bloquant, SAFETY…). Ne vérifie PAS la propriété : appelé par le service d'incidents. */
  async dispute(
    missionId: string,
    actorUserId: string | null,
    reason: string,
    options: {
      tx?: Tx;
      actorType?: MissionActorType;
      metadata?: Prisma.InputJsonObject;
    } = {},
  ): Promise<Mission> {
    return this.run(options.tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.DISPUTED);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.DISPUTED,
        actorUserId,
        actorType: options.actorType ?? MissionActorType.SYSTEM,
        reason,
        metadata: options.metadata,
      });
      return this.reload(db, missionId);
    });
  }

  // ---------- Internes ----------

  private run<T>(tx: Tx | undefined, fn: (db: Tx) => Promise<T>): Promise<T> {
    if (tx) {
      return fn(tx);
    }
    return this.prisma.$transaction((db) => fn(db));
  }

  private async load(db: Tx, missionId: string): Promise<Mission> {
    const mission = await db.mission.findUnique({ where: { id: missionId } });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    return mission;
  }

  private reload(db: Tx, missionId: string): Promise<Mission> {
    return this.load(db, missionId);
  }

  /** Un non-propriétaire reçoit 404 (pas de fuite d'existence). */
  private assertOwner(mission: Mission, userId: string) {
    if (mission.clientUserId !== userId) {
      throw new NotFoundException('Mission introuvable');
    }
  }

  /**
   * Applique une transition avec verrou optimiste (updateMany conditionnel sur l'ancien
   * statut) puis écrit systématiquement une ligne MissionStatusHistory.
   */
  private async applyTransition(db: Tx, input: TransitionInput): Promise<void> {
    const from = input.mission.status;
    assertTransition(from, input.to);

    const result = await db.mission.updateMany({
      where: { ...input.where, id: input.mission.id, status: from },
      data: { ...input.data, status: input.to },
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'Le statut de la mission a changé entre-temps, veuillez réessayer.',
      );
    }

    await db.missionStatusHistory.create({
      data: {
        missionId: input.mission.id,
        fromStatus: from,
        toStatus: input.to,
        actorUserId: input.actorUserId ?? null,
        reason: input.reason ?? null,
        metadata: { actorType: input.actorType, ...input.metadata },
      },
    });
  }
}
