import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionActorType,
  MissionAssignmentStatus,
  MissionIncidentStatus,
  MissionIncidentType,
  MissionStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AdminIncidentsQueryDto } from './dto/mission-queries.dto';
import type { ReportIncidentDto } from './dto/report-incident.dto';
import {
  canTransition,
  MissionLifecycleService,
} from './mission-lifecycle.service';
import { resolvePagination } from './mission-rules';
import { serializeIncident } from './mission-serializers';

/** Un incident n'a de sens qu'une fois un Jobber sélectionné. */
const INCIDENT_ALLOWED_STATUSES: ReadonlySet<MissionStatus> = new Set([
  MissionStatus.APPLICATION_SELECTED,
  MissionStatus.PAYMENT_REQUIRED,
  MissionStatus.CONFIRMED,
  MissionStatus.READY_TO_START,
  MissionStatus.IN_PROGRESS,
  MissionStatus.COMPLETION_PENDING,
  MissionStatus.COMPLETED,
  MissionStatus.DISPUTED,
]);

/** Un no-show ne peut être déclaré qu'avant le démarrage. */
const NO_SHOW_STATUSES: ReadonlySet<MissionStatus> = new Set([
  MissionStatus.CONFIRMED,
  MissionStatus.READY_TO_START,
]);

const INCIDENT_TRANSITIONS: Readonly<
  Record<MissionIncidentStatus, readonly MissionIncidentStatus[]>
> = {
  [MissionIncidentStatus.OPEN]: [
    MissionIncidentStatus.UNDER_REVIEW,
    MissionIncidentStatus.RESOLVED,
    MissionIncidentStatus.CLOSED,
  ],
  [MissionIncidentStatus.UNDER_REVIEW]: [
    MissionIncidentStatus.RESOLVED,
    MissionIncidentStatus.CLOSED,
  ],
  [MissionIncidentStatus.RESOLVED]: [MissionIncidentStatus.CLOSED],
  [MissionIncidentStatus.CLOSED]: [],
};

@Injectable()
export class MissionIncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MissionLifecycleService,
  ) {}

  /**
   * Client propriétaire ou Jobber sélectionné.
   * - JOBBER_NO_SHOW : signalé par le Client ; CLIENT_NO_SHOW : signalé par le Jobber.
   * - blocksMission === true ou type SAFETY → mission DISPUTED (si la transition est possible).
   */
  async report(userId: string, missionId: string, dto: ReportIncidentDto) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    const isClient = mission.clientUserId === userId;
    const assignment = isClient
      ? null
      : await this.prisma.missionAssignment.findFirst({
          where: {
            missionId,
            jobberUserId: userId,
            status: MissionAssignmentStatus.ACTIVE,
          },
        });
    const isJobber =
      Boolean(assignment) || mission.selectedJobberUserId === userId;
    if (!isClient && !isJobber) {
      throw new NotFoundException('Mission introuvable');
    }
    if (!INCIDENT_ALLOWED_STATUSES.has(mission.status)) {
      throw new ConflictException(
        `Aucun incident ne peut être signalé lorsque la mission est ${mission.status}.`,
      );
    }

    if (dto.type === MissionIncidentType.JOBBER_NO_SHOW && !isClient) {
      throw new ForbiddenException(
        'Seul le Client peut signaler l’absence du Jobber.',
      );
    }
    if (dto.type === MissionIncidentType.CLIENT_NO_SHOW && !isJobber) {
      throw new ForbiddenException(
        'Seul le Jobber peut signaler l’absence du Client.',
      );
    }
    const isNoShow =
      dto.type === MissionIncidentType.JOBBER_NO_SHOW ||
      dto.type === MissionIncidentType.CLIENT_NO_SHOW;
    if (isNoShow) {
      if (!NO_SHOW_STATUSES.has(mission.status)) {
        throw new ConflictException(
          'Une absence ne peut être signalée que sur une mission confirmée non démarrée.',
        );
      }
      if (mission.scheduledStartAt && mission.scheduledStartAt > new Date()) {
        throw new ConflictException(
          'L’heure de début prévue n’est pas encore passée.',
        );
      }
    }

    const blocksMission =
      dto.blocksMission === true || dto.type === MissionIncidentType.SAFETY;
    const actorType = isClient
      ? MissionActorType.CLIENT
      : MissionActorType.JOBBER;

    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.missionIncident.create({
        data: {
          missionId,
          reportedByUserId: userId,
          type: dto.type,
          description: dto.description.trim(),
          status: MissionIncidentStatus.OPEN,
          blocksMission,
        },
      });

      let missionStatus: MissionStatus = mission.status;
      if (
        blocksMission &&
        canTransition(mission.status, MissionStatus.DISPUTED)
      ) {
        const disputed = await this.lifecycle.dispute(
          missionId,
          userId,
          `Incident ${dto.type}`,
          { tx, actorType, metadata: { incidentId: incident.id } },
        );
        missionStatus = disputed.status;
      }

      return {
        ...serializeIncident(incident),
        missionStatus,
      };
    });
  }

  // ---------- Admin ----------

  async adminList(query: AdminIncidentsQueryDto) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.MissionIncidentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.missionId ? { missionId: query.missionId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.missionIncident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.missionIncident.count({ where }),
    ]);
    return { items: items.map(serializeIncident), page, limit, total };
  }

  async adminUpdateStatus(incidentId: string, status: MissionIncidentStatus) {
    const incident = await this.prisma.missionIncident.findUnique({
      where: { id: incidentId },
    });
    if (!incident) {
      throw new NotFoundException('Incident introuvable');
    }
    if (!INCIDENT_TRANSITIONS[incident.status].includes(status)) {
      throw new ConflictException(
        `Transition d’incident interdite : ${incident.status} → ${status}`,
      );
    }

    const isFinal =
      status === MissionIncidentStatus.RESOLVED ||
      status === MissionIncidentStatus.CLOSED;
    const result = await this.prisma.missionIncident.updateMany({
      where: { id: incidentId, status: incident.status },
      data: {
        status,
        resolvedAt: isFinal ? (incident.resolvedAt ?? new Date()) : null,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'Le statut de l’incident a changé entre-temps.',
      );
    }
    const updated = await this.prisma.missionIncident.findUnique({
      where: { id: incidentId },
    });
    if (!updated) {
      throw new NotFoundException('Incident introuvable');
    }
    return serializeIncident(updated);
  }
}
