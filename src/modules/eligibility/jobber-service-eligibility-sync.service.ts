import { Injectable, NotFoundException } from '@nestjs/common';
import {
  JobberServiceStatus,
  ServiceRequirementType,
  UserDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JobberEligibilityService } from './jobber-eligibility.service';

/**
 * Synchronise JobberService.status avec les exigences DOCUMENT (UserDocument APPROVED).
 * Source de vérité pour l'éligibilité par service (distincte de la validation dossier globale).
 */
@Injectable()
export class JobberServiceEligibilitySync {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: JobberEligibilityService,
  ) {}

  async loadApprovedDocumentTypeIds(userId: string): Promise<Set<string>> {
    const docs = await this.prisma.userDocument.findMany({
      where: { userId, status: UserDocumentStatus.APPROVED },
      select: { documentTypeId: true },
    });
    return new Set(docs.map((d) => d.documentTypeId));
  }

  async recomputeForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        dateOfBirth: true,
        legalGuardianStatus: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
    if (!user) return;

    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) return;

    const approvedDocumentTypeIds =
      await this.loadApprovedDocumentTypeIds(userId);

    const jobberServices = await this.prisma.jobberService.findMany({
      where: { jobberProfileId: profile.id },
      include: {
        service: {
          include: {
            requirements: { where: { isActive: true } },
          },
        },
      },
    });

    for (const js of jobberServices) {
      if (js.status === JobberServiceStatus.SUSPENDED) {
        continue;
      }
      const result = this.eligibility.evaluate({
        user,
        jobber: { status: profile.status },
        service: js.service,
        requirements: js.service.requirements,
        approvedDocumentTypeIds,
      });
      if (js.status !== result.status) {
        await this.prisma.jobberService.update({
          where: { id: js.id },
          data: { status: result.status },
        });
      }
    }
  }

  /**
   * Synthèse pour le parcours Jobber / futur mobile :
   * exigences DOCUMENT dédupliquées + statut des pièces + manquants.
   */
  async getDocumentRequirementsSummary(userId: string) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Profil Jobber non activé');
    }

    const jobberServices = await this.prisma.jobberService.findMany({
      where: { jobberProfileId: profile.id },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            slug: true,
            requirements: {
              where: {
                isActive: true,
                isRequired: true,
                type: ServiceRequirementType.DOCUMENT,
              },
              include: {
                documentType: {
                  select: { id: true, code: true, name: true, isActive: true },
                },
              },
            },
          },
        },
      },
    });

    const documents = await this.prisma.userDocument.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      include: {
        documentType: { select: { id: true, code: true, name: true } },
      },
    });

    type ReqAgg = {
      documentTypeId: string;
      documentTypeCode: string;
      documentTypeName: string;
      requiredForServices: Array<{ id: string; name: string; slug: string }>;
    };
    const byType = new Map<string, ReqAgg>();

    for (const js of jobberServices) {
      for (const req of js.service.requirements) {
        if (!req.documentTypeId || !req.documentType) continue;
        const existing = byType.get(req.documentTypeId);
        const serviceRef = {
          id: js.service.id,
          name: js.service.name,
          slug: js.service.slug,
        };
        if (existing) {
          if (
            !existing.requiredForServices.some((s) => s.id === serviceRef.id)
          ) {
            existing.requiredForServices.push(serviceRef);
          }
        } else {
          byType.set(req.documentTypeId, {
            documentTypeId: req.documentTypeId,
            documentTypeCode: req.documentType.code,
            documentTypeName: req.documentType.name,
            requiredForServices: [serviceRef],
          });
        }
      }
    }

    const latestByType = new Map<string, (typeof documents)[number]>();
    for (const doc of documents) {
      if (!latestByType.has(doc.documentTypeId)) {
        latestByType.set(doc.documentTypeId, doc);
      }
    }

    const requirements = [...byType.values()].map((req) => {
      const doc = latestByType.get(req.documentTypeId);
      const status = doc?.status ?? null;
      const satisfied = status === UserDocumentStatus.APPROVED;
      return {
        documentType: {
          id: req.documentTypeId,
          code: req.documentTypeCode,
          name: req.documentTypeName,
        },
        required: true,
        requiredForServices: req.requiredForServices,
        document: doc
          ? {
              id: doc.id,
              status: doc.status,
              submittedAt: doc.submittedAt.toISOString(),
              reviewedAt: doc.reviewedAt?.toISOString() ?? null,
            }
          : null,
        satisfied,
        missing: !satisfied,
      };
    });

    return {
      services: jobberServices.map((js) => ({
        id: js.service.id,
        name: js.service.name,
        slug: js.service.slug,
        jobberServiceStatus: js.status,
      })),
      requirements,
      missing: requirements
        .filter((r) => r.missing)
        .map((r) => ({
          documentType: r.documentType,
          requiredForServices: r.requiredForServices,
          status: r.document?.status ?? null,
        })),
    };
  }
}
