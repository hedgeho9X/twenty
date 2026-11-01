/** Verifies isolation configuration cannot inherit schema-changing behavior or consume the ordinary query pool. */
import { type DataSource } from 'typeorm';
import { recruitingLockPoolOptions } from './lock-pool.options';

it('keeps transport settings but uses an entity-free independent bounded pool without DDL', () => {
  const original = {
    type: 'postgres',
    url: 'postgres://test.invalid/database',
    poolSize: 2,
    extra: { query_timeout: 1234, max: 2 },
    entities: ['entities'],
    migrations: ['migrations'],
    synchronize: true,
    migrationsRun: true,
    dropSchema: true,
  };
  const options = recruitingLockPoolOptions({
    options: original,
  } as unknown as DataSource);
  expect(options).toMatchObject({
    name: 'recruiting-locks',
    url: original.url,
    poolSize: 18,
    extra: { max: 18, query_timeout: 1234 },
    entities: [],
    subscribers: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    installExtensions: false,
    autoLoadEntities: false,
  });
  expect(original.poolSize).toBe(2);
  expect(original.entities).toEqual(['entities']);
});

it('does not silently run session advisory locks on another database driver', () => {
  expect(() =>
    recruitingLockPoolOptions({ options: { type: 'sqlite' } } as DataSource),
  ).toThrow('PostgreSQL');
});
