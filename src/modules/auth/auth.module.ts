import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { AuthConfig } from '../../config/configuration';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const auth = configService.getOrThrow<AuthConfig>('auth');
        return {
          secret: auth.jwtAccessSecret,
          signOptions: {
            expiresIn: auth.jwtAccessTtl as `${number}m`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, TokensService, JwtStrategy],
  exports: [AuthService, SessionsService, TokensService, JwtModule],
})
export class AuthModule {}
