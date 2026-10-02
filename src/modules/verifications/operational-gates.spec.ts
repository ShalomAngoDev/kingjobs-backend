import { ForbiddenException } from '@nestjs/common';
import {
  IdentityVerificationStatus,
  JobberStatus,
  LegalGuardianStatus,
  UserStatus,
} from '@prisma/client';
import {
  assertUserCanOperateAsClient,
  assertUserCanOperateAsJobber,
} from './operational-gates';

const verified = {
  status: UserStatus.ACTIVE,
  identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
  legalGuardianStatus: LegalGuardianStatus.NOT_REQUIRED,
};

describe('operational gates', () => {
  describe('assertUserCanOperateAsClient', () => {
    it('accepts a verified active user (guardian not required or approved)', () => {
      expect(() => assertUserCanOperateAsClient(verified)).not.toThrow();
      expect(() =>
        assertUserCanOperateAsClient({
          ...verified,
          legalGuardianStatus: LegalGuardianStatus.APPROVED,
        }),
      ).not.toThrow();
    });

    it.each([
      { identityVerificationStatus: IdentityVerificationStatus.UNVERIFIED },
      { identityVerificationStatus: IdentityVerificationStatus.PENDING },
      { status: UserStatus.SUSPENDED },
      { legalGuardianStatus: LegalGuardianStatus.REQUIRED },
      { legalGuardianStatus: LegalGuardianStatus.PENDING },
    ])('refuses %j', (override) => {
      expect(() =>
        assertUserCanOperateAsClient({ ...verified, ...override }),
      ).toThrow(ForbiddenException);
    });

    it('refuses a missing user', () => {
      expect(() => assertUserCanOperateAsClient(null)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertUserCanOperateAsJobber', () => {
    it('requires a verified identity and an ACTIVE jobber profile', () => {
      expect(() =>
        assertUserCanOperateAsJobber(verified, { status: JobberStatus.ACTIVE }),
      ).not.toThrow();
      expect(() =>
        assertUserCanOperateAsJobber(verified, {
          status: JobberStatus.PENDING_VERIFICATION,
        }),
      ).toThrow(ForbiddenException);
      expect(() => assertUserCanOperateAsJobber(verified, null)).toThrow(
        ForbiddenException,
      );
      expect(() =>
        assertUserCanOperateAsJobber(
          {
            ...verified,
            identityVerificationStatus:
              IdentityVerificationStatus.NEEDS_CHANGES,
          },
          { status: JobberStatus.ACTIVE },
        ),
      ).toThrow(ForbiddenException);
    });
  });
});
