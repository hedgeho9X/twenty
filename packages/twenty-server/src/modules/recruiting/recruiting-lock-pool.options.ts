/** Isolates long-lived recruiting advisory sessions from the core query pool. */
import { type DataSource } from 'typeorm';

/** Reuses native database transport while preventing migrations, entity sync or DDL on the lock-only connection. */
export const recruitingLockPoolOptions = (core: DataSource) => {
  if (core.options.type !== 'postgres')
    throw new Error('Recruiting locks require PostgreSQL');
  return {
    ...core.options,
    name: 'recruiting-locks',
    poolSize: 18,
    extra: { ...core.options.extra, max: 18 },
    autoLoadEntities: false,
    entities: [],
    subscribers: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    installExtensions: false,
    logging: false as const,
  };
};
