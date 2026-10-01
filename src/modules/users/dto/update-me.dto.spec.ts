import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMeDto } from './update-me.dto';

describe('UpdateMeDto', () => {
  it('accepte firstName / lastName uniquement', async () => {
    const dto = plainToInstance(UpdateMeDto, {
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('ne déclare pas de champ role (pas d’auto-promotion via PATCH /users/me)', () => {
    expect(new UpdateMeDto()).not.toHaveProperty('role');
  });

  it('rejette role via ValidationPipe forbidNonWhitelisted', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { firstName: 'Ada', role: 'SUPER_ADMIN' },
        { type: 'body', metatype: UpdateMeDto },
      ),
    ).rejects.toBeTruthy();
  });
});
