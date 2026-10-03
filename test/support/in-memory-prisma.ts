import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Faux PrismaService en mémoire pour les tests missions (unitaires + e2e).
 * Supporte le sous-ensemble de l'API Prisma utilisé par le module missions :
 * findUnique/findFirst/findMany/count/create/update/updateMany, filtres simples
 * (égalité, null, in, not, lt/lte/gt/gte, equals+insensitive), orderBy/skip/take,
 * $transaction interactive (sérialisée + rollback), $queryRaw (nextval) et $executeRaw.
 */
type Row = Record<string, any>;
type Where = Record<string, any>;

function isPlainObject(value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function cmp(a: any, b: any): number {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return left < right ? -1 : 1;
}

function matchField(value: any, cond: any): boolean {
  if (cond === null) return value === null || value === undefined;
  if (!isPlainObject(cond)) return eq(value, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case 'equals':
        if (cond.mode === 'insensitive') {
          return (
            typeof value === 'string' &&
            value.toLowerCase() === String(arg).toLowerCase()
          );
        }
        return eq(value, arg);
      case 'mode':
        return true;
      case 'not':
        return !matchField(value, arg);
      case 'in':
        return (arg as unknown[]).some((v) => eq(v, value));
      case 'notIn':
        return !(arg as unknown[]).some((v) => eq(v, value));
      case 'lt':
        return value != null && cmp(value, arg) < 0;
      case 'lte':
        return value != null && cmp(value, arg) <= 0;
      case 'gt':
        return value != null && cmp(value, arg) > 0;
      case 'gte':
        return value != null && cmp(value, arg) >= 0;
      default:
        throw new Error(`InMemoryPrisma: opérateur non supporté "${op}"`);
    }
  });
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'AND') {
      return (cond as Where[]).every((w) => matches(row, w));
    }
    if (key === 'OR') {
      return (cond as Where[]).some((w) => matches(row, w));
    }
    return matchField(row[key], cond);
  });
}

class Table {
  rows: Row[] = [];

  constructor(
    private readonly name: string,
    private readonly defaults: () => Row,
    private readonly db: InMemoryPrisma,
  ) {}

  private attach(row: Row, args?: { include?: any; select?: any }): Row {
    const copy: Row = { ...row };
    if (this.name === 'service') {
      copy.category =
        this.db
          .table('serviceCategory')
          .rows.find((c) => c.id === row.categoryId) ?? null;
    }
    if (this.name === 'user') {
      copy.jobberProfile =
        this.db.table('jobberProfile').rows.find((p) => p.userId === row.id) ??
        null;
    }
    if (this.name === 'missionApplication' && args?.include?.assignment) {
      copy.assignment =
        this.db
          .table('missionAssignment')
          .rows.find((a) => a.applicationId === row.id) ?? null;
    }
    if (this.name === 'missionApplication' && args?.include?.mission) {
      copy.mission =
        this.db.table('mission').rows.find((m) => m.id === row.missionId) ??
        null;
    }
    if (this.name === 'missionAssignment' && args?.include?.mission) {
      copy.mission =
        this.db.table('mission').rows.find((m) => m.id === row.missionId) ??
        null;
    }
    if (this.name === 'mission' && args?.include?.client) {
      const client =
        this.db.table('user').rows.find((u) => u.id === row.clientUserId) ??
        null;
      if (client && isPlainObject(args.include.client.select)) {
        const selected: Row = {};
        for (const [key, enabled] of Object.entries(
          args.include.client.select,
        )) {
          if (enabled) selected[key] = client[key];
        }
        copy.client = selected;
      } else {
        copy.client = client;
      }
    }
    void args;
    return copy;
  }

  findUnique = (args: { where: Where; include?: any; select?: any }) => {
    const row = this.rows.find((r) => matches(r, args.where));
    return Promise.resolve(row ? this.attach(row, args) : null);
  };

  findFirst = (args: {
    where?: Where;
    orderBy?: any;
    include?: any;
    select?: any;
  }) => {
    const found = this.sorted(
      this.rows.filter((r) => matches(r, args.where)),
      args.orderBy,
    );
    return Promise.resolve(found[0] ? this.attach(found[0], args) : null);
  };

  findMany = (
    args: {
      where?: Where;
      orderBy?: any;
      skip?: number;
      take?: number;
      include?: any;
      select?: any;
    } = {},
  ) => {
    let found = this.sorted(
      this.rows.filter((r) => matches(r, args.where)),
      args.orderBy,
    );
    if (args.skip) found = found.slice(args.skip);
    if (args.take !== undefined) found = found.slice(0, args.take);
    return Promise.resolve(found.map((r) => this.attach(r, args)));
  };

  count = (args: { where?: Where } = {}) =>
    Promise.resolve(this.rows.filter((r) => matches(r, args.where)).length);

  create = (args: { data: Row }) => {
    const now = new Date();
    const row: Row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...this.defaults(),
    };
    for (const [key, value] of Object.entries(args.data)) {
      if (value !== undefined) row[key] = value;
    }
    this.rows.push(row);
    return Promise.resolve({ ...row });
  };

  private apply(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (isPlainObject(value) && 'increment' in value) {
        row[key] = (row[key] ?? 0) + (value.increment as number);
      } else {
        row[key] = value;
      }
    }
    row.updatedAt = new Date();
  }

  update = (args: { where: Where; data: Row }) => {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) return Promise.reject(new Error(`${this.name}: not found`));
    this.apply(row, args.data);
    return Promise.resolve({ ...row });
  };

  createMany = (args: { data: Row[] }) => {
    for (const data of args.data) void this.create({ data });
    return Promise.resolve({ count: args.data.length });
  };

  deleteMany = (args: { where?: Where } = {}) => {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, args.where));
    return Promise.resolve({ count: before - this.rows.length });
  };

  updateMany = (args: { where?: Where; data: Row }) => {
    const targets = this.rows.filter((r) => matches(r, args.where));
    for (const row of targets) this.apply(row, args.data);
    return Promise.resolve({ count: targets.length });
  };

  private sorted(rows: Row[], orderBy: any): Row[] {
    if (!orderBy) return [...rows];
    const [[field, dir]] = Object.entries(
      Array.isArray(orderBy) ? orderBy[0] : orderBy,
    ) as [[string, 'asc' | 'desc']];
    return [...rows].sort((a, b) => {
      const result = cmp(a[field], b[field]);
      return dir === 'desc' ? -result : result;
    });
  }
}

const TABLE_DEFAULTS: Record<string, () => Row> = {
  user: () => ({
    identityVerificationStatus: 'UNVERIFIED',
    legalGuardianStatus: 'NOT_REQUIRED',
    countryCode: 'BJ',
    addressLine: null,
    city: null,
    administrativeArea: null,
  }),
  clientProfile: () => ({}),
  jobberProfile: () => ({ status: 'ACTIVE' }),
  jobberService: () => ({ status: 'ELIGIBLE' }),
  service: () => ({ isActive: true, minimumAge: 16 }),
  serviceCategory: () => ({ isActive: true }),
  serviceRequirement: () => ({ isActive: true }),
  mission: () => ({
    status: 'DRAFT',
    countryCode: 'BJ',
    currency: 'XOF',
    district: null,
    addressLine: null,
    locationNotes: null,
    latitude: null,
    longitude: null,
    schedulingType: 'ONCE',
    scheduleStartDate: null,
    scheduleEndDate: null,
    scheduleSameHoursDaily: null,
    selectedWeekdays: [],
    durationKnown: true,
    scheduledStartAt: null,
    estimatedDurationMinutes: null,
    workersNeeded: 1,
    pricingType: 'FIXED',
    rateAmount: null,
    rateScope: 'PER_JOBBER',
    estimatedAmount: null,
    paymentConfirmedAt: null,
    submittedForReviewAt: null,
    reviewInternalNote: null,
    clientReviewMessage: null,
    reviewChangeAreas: [],
    rejectionReasonCode: null,
    rejectionReasonText: null,
    financialFollowUpRequired: false,
    minimumAge: 16,
    riskFlags: [],
    selectedJobberUserId: null,
    publishedAt: null,
    assignedAt: null,
    confirmedAt: null,
    startedAt: null,
    completionRequestedAt: null,
    completedAt: null,
    cancelledAt: null,
  }),
  missionOccurrence: () => ({
    plannedStartAt: null,
    plannedEndAt: null,
    estimatedDurationMinutes: null,
    sortOrder: 0,
  }),
  missionApplication: () => ({
    status: 'PENDING',
    message: null,
    appliedAt: new Date(),
    withdrawnAt: null,
    selectedAt: null,
    rejectedAt: null,
    closedAt: null,
  }),
  missionAssignment: () => ({
    status: 'ACTIVE',
    cancelledAt: null,
    cancellationReason: null,
    workerGrossAmount: 0,
    commissionRateBps: 1500,
    currency: 'XOF',
  }),
  missionVerification: () => ({
    attempts: 0,
    maxAttempts: 5,
    usedAt: null,
    expiresAt: null,
  }),
  missionCancellation: () => ({ reasonText: null }),
  missionIncident: () => ({
    status: 'OPEN',
    blocksMission: false,
    resolvedAt: null,
  }),
  documentType: () => ({ isActive: true }),
  userDocument: () => ({
    status: 'PENDING',
    verificationCaseId: null,
    identitySubType: null,
    originalFilename: null,
    capturedAt: null,
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedById: null,
    reasonCode: null,
    userMessage: null,
  }),
  userDocumentEvent: () => ({ actorId: null, metadata: null }),
  verificationCase: () => ({
    status: 'DRAFT',
    submittedAt: null,
    reviewedAt: null,
    reviewedById: null,
    userMessage: null,
    internalNote: null,
    reasonCode: null,
    resubmitOfId: null,
  }),
  adminAuditEvent: () => ({ metadata: null }),
  missionStatusHistory: () => ({
    fromStatus: null,
    actorUserId: null,
    reason: null,
    metadata: null,
  }),
};

export class InMemoryPrisma {
  private readonly tables = new Map<string, Table>();
  private sequence = 0;
  private lock: Promise<unknown> = Promise.resolve();

  readonly user = this.table('user');
  readonly clientProfile = this.table('clientProfile');
  readonly jobberProfile = this.table('jobberProfile');
  readonly jobberService = this.table('jobberService');
  readonly service = this.table('service');
  readonly serviceCategory = this.table('serviceCategory');
  readonly serviceRequirement = this.table('serviceRequirement');
  readonly mission = this.table('mission');
  readonly missionApplication = this.table('missionApplication');
  readonly missionAssignment = this.table('missionAssignment');
  readonly missionVerification = this.table('missionVerification');
  readonly missionCancellation = this.table('missionCancellation');
  readonly missionIncident = this.table('missionIncident');
  readonly missionStatusHistory = this.table('missionStatusHistory');
  readonly missionOccurrence = this.table('missionOccurrence');
  readonly missionMedia = this.table('missionMedia');
  readonly documentType = this.table('documentType');
  readonly userDocument = this.table('userDocument');
  readonly userDocumentEvent = this.table('userDocumentEvent');
  readonly verificationCase = this.table('verificationCase');
  readonly userLanguage = this.table('userLanguage');
  readonly jobberEducation = this.table('jobberEducation');
  readonly jobberExperience = this.table('jobberExperience');
  readonly jobberSkill = this.table('jobberSkill');
  readonly adminAuditEvent = this.table('adminAuditEvent');

  readonly $queryRaw = jest.fn(() =>
    Promise.resolve([{ nextval: BigInt(++this.sequence) }]),
  );
  readonly $executeRaw = jest.fn(() => Promise.resolve(0));

  table(name: string): Table {
    let table = this.tables.get(name);
    if (!table) {
      table = new Table(name, TABLE_DEFAULTS[name] ?? (() => ({})), this);
      this.tables.set(name, table);
    }
    return table;
  }

  /** Transaction interactive : sérialisée, rollback complet en cas d'exception. */
  $transaction = <T>(fn: (tx: InMemoryPrisma) => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const snapshot = new Map(
        [...this.tables.entries()].map(([name, t]) => [
          name,
          t.rows.map((r) => ({ ...r })),
        ]),
      );
      try {
        return await fn(this);
      } catch (error) {
        for (const [name, rows] of snapshot) {
          this.tables.get(name)!.rows = rows;
        }
        throw error;
      }
    };
    const next = this.lock.then(run, run);
    this.lock = next.catch(() => undefined);
    return next;
  };

  asPrismaService(): PrismaService {
    return this as unknown as PrismaService;
  }
}
