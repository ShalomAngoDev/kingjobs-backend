import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionActorType,
  MissionApplicationStatus,
  MissionStatus,
  type Mission,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CancelMissionDto } from './dto/cancel-mission.dto';
import { computeMinimumAge } from './mission-rules';

export type Tx = Prisma.TransactionClient;

/**
 * Machine à états explicite des missions.
 * Aucune route ne permet de PATCH le status : seules les méthodes de
 * MissionLifecycleService appliquent ces transitions.
 */
export const MISSION_TRANSITIONS: Readonly<
  Record<MissionStatus, readonly MissionStatus[]>
> = {
  [MissionStatus.DRAFT]: [MissionStatus.PUBLISHED, MissionStatus.CANCELLED],
  [MissionStatus.PUBLISHED]: [
    MissionStatus.APPLICATION_SELECTED,
    MissionStatus.CANCELLED,
  ],
  [MissionStatus.APPLICATION_SELECTED]: [
    MissionStatus.PAYMENT_REQUIRED,
    MissionStatus.CANCELLED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.PAYMENT_REQUIRED]: [
    MissionStatus.CONFIRMED,
    MissionStatus.CANCELLED,
    MissionStatus.DISPUTED,
  ],
  [MissionStatus.CONFIRMED]: [
    MissionStatus.READY_TO_START,
    MissionStatus.IN_PROGRESS,
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
  MissionStatus.PUBLISHED,
  MissionStatus.APPLICATION_SELECTED,
  MissionStatus.PAYMENT_REQUIRED,
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

  /** DRAFT → PUBLISHED (rafraîchit snapshots et minimumAge si le service est toujours actif). */
  async publish(
    missionId: string,
    clientUserId: string,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      this.assertOwner(mission, clientUserId);
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
          'La date de début prévue est passée : modifiez-la avant de publier.',
        );
      }

      await this.applyTransition(db, {
        mission,
        to: MissionStatus.PUBLISHED,
        actorUserId: clientUserId,
        actorType: MissionActorType.CLIENT,
        where: { clientUserId },
        data: {
          publishedAt: new Date(),
          serviceNameSnapshot: service.name,
          serviceSlugSnapshot: service.slug,
          categoryNameSnapshot: service.category.name,
          categorySlugSnapshot: service.category.slug,
          minimumAge: computeMinimumAge(service.minimumAge, mission.riskFlags),
        },
      });
      return this.reload(db, missionId);
    });
  }

  /**
   * PUBLISHED → APPLICATION_SELECTED → PAYMENT_REQUIRED, dans UNE transaction.
   * Le verrou est un updateMany conditionnel (status PUBLISHED, aucun Jobber déjà choisi) :
   * deux sélections concurrentes → une seule passe (count === 1), l'autre reçoit 409.
   */
  async selectApplication(
    missionId: string,
    applicationId: string,
    clientUserId: string,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      this.assertOwner(mission, clientUserId);

      if (mission.status !== MissionStatus.PUBLISHED) {
        throw new ConflictException(
          'Un Jobber ne peut être sélectionné que sur une mission publiée.',
        );
      }

      const application = await db.missionApplication.findUnique({
        where: { id: applicationId },
      });
      if (!application || application.missionId !== missionId) {
        throw new NotFoundException('Candidature introuvable');
      }
      if (application.status !== MissionApplicationStatus.PENDING) {
        throw new ConflictException(
          'Cette candidature n’est plus sélectionnable.',
        );
      }

      const now = new Date();
      // 1) Verrou : une seule transaction peut quitter PUBLISHED sans Jobber sélectionné.
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.APPLICATION_SELECTED,
        actorUserId: clientUserId,
        actorType: MissionActorType.CLIENT,
        where: { clientUserId, selectedJobberUserId: null },
        metadata: {
          applicationId,
          selectedJobberUserId: application.jobberUserId,
        },
        data: {
          selectedJobberUserId: application.jobberUserId,
          assignedAt: now,
        },
      });

      // 2) Candidature choisie (garde PENDING → rejette si retirée entre-temps).
      const selected = await db.missionApplication.updateMany({
        where: {
          id: applicationId,
          missionId,
          status: MissionApplicationStatus.PENDING,
        },
        data: { status: MissionApplicationStatus.SELECTED, selectedAt: now },
      });
      if (selected.count !== 1) {
        // Annule toute la transaction (verrou inclus).
        throw new ConflictException(
          'Cette candidature n’est plus disponible (retirée ?).',
        );
      }

      // 3) Les autres candidatures en attente sont rejetées.
      await db.missionApplication.updateMany({
        where: {
          missionId,
          id: { not: applicationId },
          status: MissionApplicationStatus.PENDING,
        },
        data: { status: MissionApplicationStatus.REJECTED, rejectedAt: now },
      });

      // 4) Le paiement est désormais requis (Backend 05 confirmera le paiement).
      await this.applyTransition(db, {
        mission: { id: missionId, status: MissionStatus.APPLICATION_SELECTED },
        to: MissionStatus.PAYMENT_REQUIRED,
        actorUserId: clientUserId,
        actorType: MissionActorType.SYSTEM,
        reason: 'Paiement requis après sélection du Jobber',
      });

      return this.reload(db, missionId);
    });
  }

  /**
   * PAYMENT_REQUIRED → CONFIRMED. USAGE INTERNE UNIQUEMENT (Backend 05 / tests) :
   * aucun endpoint HTTP n'expose cette méthode.
   */
  async markPaymentConfirmed(
    missionId: string,
    actorUserId?: string | null,
    tx?: Tx,
  ): Promise<Mission> {
    return this.run(tx, async (db) => {
      const mission = await this.load(db, missionId);
      assertTransition(mission.status, MissionStatus.CONFIRMED);
      await this.applyTransition(db, {
        mission,
        to: MissionStatus.CONFIRMED,
        actorUserId: actorUserId ?? null,
        actorType: MissionActorType.SYSTEM,
        reason: 'Paiement confirmé',
        data: { confirmedAt: new Date() },
      });
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
          'Seul le Jobber sélectionné peut demander la clôture.',
        );
      }
      if (mission.selectedJobberUserId !== jobberUserId) {
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
      const isJobber = mission.selectedJobberUserId === actorUserId;
      if (!isClient && !isJobber) {
        throw new NotFoundException('Mission introuvable');
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
        data: { status: MissionApplicationStatus.REJECTED, rejectedAt: now },
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
