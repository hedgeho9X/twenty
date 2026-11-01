/** Reserves independent lock sessions so ten ingestion jobs cannot exhaust connections needed by their own CRUD. */
import { Module } from '@nestjs/common';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PostgresAdvisoryLockService } from 'src/database/typeorm/postgres-advisory-lock.service';
import { RECRUITING_ADVISORY_LOCK } from './advisory-lock.constant';
import { recruitingLockPoolOptions } from './lock-pool.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: 'recruiting-locks',
      inject: [getDataSourceToken()],
      useFactory: recruitingLockPoolOptions,
    }),
  ],
  providers: [
    {
      provide: RECRUITING_ADVISORY_LOCK,
      inject: [getDataSourceToken('recruiting-locks')],
      useFactory: (source: DataSource) =>
        new PostgresAdvisoryLockService(source),
    },
  ],
  exports: [RECRUITING_ADVISORY_LOCK],
})
/** Nest owns startup and shutdown of this connection; no independent process or service is added. */
export class RecruitingLockModule {}
