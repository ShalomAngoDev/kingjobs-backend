import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MissionAssignmentStatus,
  MissionStatus,
  MissionVerificationType,
  type Mission,
} from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import {
  generateFourDigitCode,
  generateOpaqueToken,
  sha256Hex,
} from '../../common/utils/crypto-tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ValidateVerificationDto } from './dto/validate-verification.dto';
import { MissionLifecycleService } from './mission-lifecycle.service';
import { serializeMissionWithAddress } from './mission-serializers';

type Phase = 'START' | 'END';

const PHASE_TYPES: Record<Phase, readonly MissionVerificationType[]> = {
  START: [MissionVerificationType.START_CODE, MissionVerificationType.START_QR],
  END: [MissionVerificationType.END_CODE, MissionVerificationType.END_QR],
};

const PHASE_STATUSES: Record<Phase, readonly MissionStatus[]> = {
  START: [MissionStatus.CONFIRMED, MissionStatus.READY_TO_START],
  END: [MissionStatus.COMPLETION_PENDING],
};

function phaseOf(type: MissionVerificationType): Phase {
  return type === MissionVerificationType.START_CODE ||
    type === MissionVerificationType.START_QR
    ? 'START'
    : 'END';
}

function isCodeType(type: MissionVerificationType): boolean {
  return (
    type === MissionVerificationType.START_CODE ||
    type === MissionVerificationType.END_CODE
  );
}

/** Hash lié à la mission et au type : un secret n'est jamais valable ailleurs. Jamais stocké en clair. */
export function hashVerificationSecret(
  missionId: string,
  type: MissionVerificationType,
  secret: string,
): string {
  return sha256Hex(`${missionId}:${type}:${secret}`);
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Preuves de présence : le Client génère un code (4 chiffres) ou un QR (jeton opaque) à
 * remettre au Jobber, qui le saisit/scanne pour déclencher le début (→ IN_PROGRESS)
 * ou la fin (→ COMPLETED) de la mission.
 */
@Injectable()
export class MissionVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MissionLifecycleService,
  ) {}

  /**
   * Client propriétaire : génère un secret (retourné UNE seule fois, seul le hash est stocké).
   * Un nouveau secret du même type invalide les précédents.
   */
  async generate(
    clientUserId: string,
    missionId: string,
    type: MissionVerificationType,
  ) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission || mission.clientUserId !== clientUserId) {
      throw new NotFoundException('Mission introuvable');
    }
    this.assertStatusForPhase(mission, phaseOf(type));

    const secret = isCodeType(type)
      ? generateFourDigitCode()
      : generateOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + MISSION_LIMITS.VERIFICATION_TTL_HOURS * 3_600_000,
    );
    const maxAttempts =
      phaseOf(type) === 'START'
        ? MISSION_LIMITS.START_CODE_MAX_ATTEMPTS
        : MISSION_LIMITS.END_CODE_MAX_ATTEMPTS;

    await this.prisma.$transaction(async (tx) => {
      await tx.missionVerification.updateMany({
        where: { missionId, type, usedAt: null },
        data: { expiresAt: now },
      });
      await tx.missionVerification.create({
        data: {
          missionId,
          type,
          secretHash: hashVerificationSecret(missionId, type, secret),
          expiresAt,
          maxAttempts,
          createdByUserId: clientUserId,
        },
      });
    });

    return isCodeType(type)
      ? { type, code: secret, expiresAt: expiresAt.toISOString() }
      : { type, token: secret, expiresAt: expiresAt.toISOString() };
  }

  /** Jobber sélectionné : valide le code/QR de début → IN_PROGRESS. */
  validateStart(
    jobberUserId: string,
    missionId: string,
    dto: ValidateVerificationDto,
  ) {
    return this.validate(jobberUserId, missionId, 'START', dto);
  }

  /** Jobber sélectionné : valide le code/QR de fin → COMPLETED. */
  validateEnd(
    jobberUserId: string,
    missionId: string,
    dto: ValidateVerificationDto,
  ) {
    return this.validate(jobberUserId, missionId, 'END', dto);
  }

  private async validate(
    jobberUserId: string,
    missionId: string,
    phase: Phase,
    dto: ValidateVerificationDto,
  ) {
    const hasCode = Boolean(dto.code);
    const hasToken = Boolean(dto.token);
    if (hasCode === hasToken) {
      throw new BadRequestException(
        'Fournissez exactement un des champs : code ou token.',
      );
    }

    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.clientUserId === jobberUserId) {
      throw new ForbiddenException(
        'Seul un Jobber affecté peut valider ce code.',
      );
    }
    const assignment = await this.prisma.missionAssignment.findFirst({
      where: {
        missionId,
        jobberUserId,
        status: MissionAssignmentStatus.ACTIVE,
      },
    });
    if (!assignment) {
      throw new NotFoundException('Mission introuvable');
    }
    this.assertStatusForPhase(mission, phase);

    const type =
      phase === 'START'
        ? hasCode
          ? MissionVerificationType.START_CODE
          : MissionVerificationType.START_QR
        : hasCode
          ? MissionVerificationType.END_CODE
          : MissionVerificationType.END_QR;

    const verification = await this.prisma.missionVerification.findFirst({
      where: { missionId, type, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    if (
      !verification ||
      (verification.expiresAt && verification.expiresAt <= now)
    ) {
      throw new BadRequestException(
        'Aucun code actif : demandez au Client d’en générer un nouveau.',
      );
    }
    if (verification.attempts >= verification.maxAttempts) {
      throw new HttpException(
        'Nombre maximal de tentatives atteint : demandez un nouveau code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const provided = (dto.code ?? dto.token) as string;
    const matches = safeEqualHex(
      hashVerificationSecret(missionId, type, provided),
      verification.secretHash,
    );
    if (!matches) {
      // Persisté hors transaction : une tentative échouée est toujours comptée.
      await this.prisma.missionVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException(
        hasCode ? 'Code invalide.' : 'QR invalide.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Usage unique : le premier claim gagne, un rejeu reçoit 409.
      const claimed = await tx.missionVerification.updateMany({
        where: { id: verification.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Ce code a déjà été utilisé.');
      }
      // Invalide les autres secrets non utilisés de la même phase (code ET QR).
      await tx.missionVerification.updateMany({
        where: {
          missionId,
          type: { in: [...PHASE_TYPES[phase]] },
          usedAt: null,
        },
        data: { expiresAt: now },
      });
      return phase === 'START'
        ? this.lifecycle.startMission(missionId, jobberUserId, tx)
        : this.lifecycle.completeMission(missionId, jobberUserId, tx);
    });

    return serializeMissionWithAddress(updated);
  }

  private assertStatusForPhase(mission: Mission, phase: Phase) {
    if (!PHASE_STATUSES[phase].includes(mission.status)) {
      throw new ConflictException(
        phase === 'START'
          ? `Le début ne peut être validé que pour une mission CONFIRMED ou READY_TO_START (actuel : ${mission.status}).`
          : `La fin ne peut être validée que pour une mission COMPLETION_PENDING (actuel : ${mission.status}).`,
      );
    }
  }
}
