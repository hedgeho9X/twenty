import { FieldMetadataType } from 'twenty-shared/types';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type CompiledStatement } from 'src/engine/twenty-orm/sql/utils/compile-named-parameters.util';
import { WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace-repository';
import { type WorkspaceTableShape } from 'src/engine/twenty-orm/table-shape/types/workspace-table-shape.type';

type WorkspaceRepositoryOptions = ConstructorParameters<
  typeof WorkspaceRepository
>[0];

const OBJECT_METADATA_ID = 'delivery-object-id';

const buildField = (name: string, type: FieldMetadataType) =>
  getFlatFieldMetadataMock({
    id: `field-${name}`,
    universalIdentifier: `field-${name}`,
    objectMetadataId: OBJECT_METADATA_ID,
    name,
    type,
    ...(type === FieldMetadataType.FILES
      ? { settings: { maxNumberOfValues: 10 } }
      : {}),
  });

const FIELDS = [
  buildField('id', FieldMetadataType.UUID),
  buildField('state', FieldMetadataType.TEXT),
  buildField('attachments', FieldMetadataType.FILES),
  buildField('updatedAt', FieldMetadataType.DATE_TIME),
  buildField('deletedAt', FieldMetadataType.DATE_TIME),
];

const flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata> = {
  byUniversalIdentifier: Object.fromEntries(
    FIELDS.map((field) => [field.universalIdentifier, field]),
  ),
  universalIdentifierById: Object.fromEntries(
    FIELDS.map((field) => [field.id, field.universalIdentifier]),
  ),
  universalIdentifiersByApplicationId: {},
};

const flatObjectMetadata = getFlatObjectMetadataMock({
  id: OBJECT_METADATA_ID,
  universalIdentifier: OBJECT_METADATA_ID,
  nameSingular: 'delivery',
  namePlural: 'deliveries',
  isSystem: true,
  fieldIds: FIELDS.map((field) => field.id),
});

const flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata> = {
  byUniversalIdentifier: { [OBJECT_METADATA_ID]: flatObjectMetadata },
  universalIdentifierById: { [OBJECT_METADATA_ID]: OBJECT_METADATA_ID },
  universalIdentifiersByApplicationId: {},
};

const tableShape: WorkspaceTableShape = {
  objectMetadataId: OBJECT_METADATA_ID,
  nameSingular: 'delivery',
  schemaName: 'workspace_1wgvd1injqtife6y4rvfbu3h5',
  tableName: 'delivery',
  columnShapeByColumnName: Object.fromEntries(
    FIELDS.map((field) => [
      field.name,
      {
        columnName: field.name,
        fieldMetadataId: field.id,
        fieldName: field.name,
        fieldMetadataType: field.type,
      },
    ]),
  ),
  columnNames: FIELDS.map((field) => field.name),
  relationShapeByFieldName: {},
  hasDeletedAtColumn: true,
};

const EMPTY_FLAT_ENTITY_MAPS = {
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
};
const API_KEY_ID = 'api-key-id';
const ROLE_ID = 'role-id';

type FileFixture = {
  id: string;
  path: string;
  settings: { isTemporaryFile: boolean; toDelete: boolean };
  status: string;
  deletedAt?: string;
};

const buildRepository = ({
  shouldBypassPermissionChecks = true,
  shouldSkipEventEmission,
  executeStatement = () => [],
  initialFiles = [],
}: {
  shouldBypassPermissionChecks?: boolean;
  shouldSkipEventEmission: boolean;
  executeStatement?: (
    statement: CompiledStatement,
  ) => Record<string, unknown>[];
  initialFiles?: FileFixture[];
}) => {
  const executedStatements: CompiledStatement[] = [];
  const files = new Map(
    initialFiles.map((file) => [file.id, structuredClone(file)]),
  );
  const fileRepository = {
    find: jest.fn(async () => [...files.values()]),
    update: jest.fn(
      async (
        criteria: { id: { value: string[] } },
        patch: Pick<FileFixture, 'settings'>,
      ) => {
        for (const id of criteria.id.value) {
          files.set(id, { ...files.get(id)!, ...structuredClone(patch) });
        }
      },
    ),
    softDelete: jest.fn(async (ids: string[]) => {
      for (const id of ids) {
        files.set(id, { ...files.get(id)!, deletedAt: 'deleted' });
      }
    }),
  };
  const emitDatabaseBatchEvent = jest.fn();

  const repository = new WorkspaceRepository({
    tableShape,
    flatObjectMetadata,
    internalContext: {
      workspaceId: 'workspace-id',
      featureFlagsMap: {},
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      objectIdByNameSingular: { delivery: OBJECT_METADATA_ID },
      eventEmitterService: { emitDatabaseBatchEvent },
      coreDataSource: { getRepository: () => fileRepository },
      userWorkspaceRoleMap: {},
      apiKeyRoleMap: { [API_KEY_ID]: ROLE_ID },
      roleIdsWithAllRecordsAccess: [ROLE_ID],
      flatRowLevelPermissionPredicateMaps: EMPTY_FLAT_ENTITY_MAPS,
      flatRowLevelPermissionPredicateGroupMaps: EMPTY_FLAT_ENTITY_MAPS,
    },
    authContext: { type: 'apiKey', apiKey: { id: API_KEY_ID } },
    executor: {
      execute: async (statement: CompiledStatement) => {
        executedStatements.push(statement);

        return executeStatement(statement);
      },
    },
    objectRecordsPermissions: {
      [OBJECT_METADATA_ID]: {
        canReadObjectRecords: true,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: true,
        canDestroyObjectRecords: true,
        restrictedFields: {},
      },
    },
    rolePermissionConfig: { intersectionOf: { apiKeyRoleId: ROLE_ID } },
    shouldBypassPermissionChecks,
    shouldSkipEventEmission,
    tableShapeByObjectMetadataId: () => tableShape,
  } as unknown as WorkspaceRepositoryOptions);

  const getExecutedStatementKinds = () =>
    executedStatements.map((statement) => statement.text.split(' ')[0]);

  return {
    repository,
    getExecutedStatementKinds,
    files,
    fileRepository,
    emitDatabaseBatchEvent,
  };
};

describe('WorkspaceRepository mutations', () => {
  describe('single-record files field updates', () => {
    it('returns no records or file side effects when the authorized before-image is empty', async () => {
      const {
        repository,
        getExecutedStatementKinds,
        fileRepository,
        emitDatabaseBatchEvent,
      } = buildRepository({
        shouldBypassPermissionChecks: false,
        shouldSkipEventEmission: false,
      });

      const result = await repository.update(
        { id: 'delivery-id' },
        { attachments: [{ fileId: 'new-file', label: 'new.pdf' }] },
      );

      expect(result.affected).toBe(0);
      expect(result.generatedMaps).toEqual([]);
      expect(getExecutedStatementKinds()).toEqual(['SELECT']);
      expect(fileRepository.find).not.toHaveBeenCalled();
      expect(fileRepository.update).not.toHaveBeenCalled();
      expect(fileRepository.softDelete).not.toHaveBeenCalled();
      expect(emitDatabaseBatchEvent).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'commits native file lifecycle and events only for an affected row (updated=%s)',
      async (updateSucceeds) => {
        const oldAttachment = { fileId: 'old-file', label: 'old.pdf' };
        const newAttachment = { fileId: 'new-file', label: 'new.pdf' };
        let updated = false;
        const {
          repository,
          getExecutedStatementKinds,
          files,
          fileRepository,
          emitDatabaseBatchEvent,
        } = buildRepository({
          shouldBypassPermissionChecks: false,
          shouldSkipEventEmission: false,
          initialFiles: [
            {
              id: 'old-file',
              path: 'files-field/field-attachments/old.pdf',
              settings: { isTemporaryFile: false, toDelete: false },
              status: 'UPLOADED',
            },
            {
              id: 'new-file',
              path: 'files-field/field-attachments/new.pdf',
              settings: { isTemporaryFile: true, toDelete: false },
              status: 'UPLOADED',
            },
          ],
          executeStatement: (statement) => {
            if (statement.text.startsWith('UPDATE')) {
              updated = updateSucceeds;
              return updated
                ? [
                    {
                      delivery_id: 'delivery-id',
                      delivery_updatedAt: '2026-11-01T00:00:01.000Z',
                    },
                  ]
                : [];
            }
            return [
              {
                delivery_id: 'delivery-id',
                delivery_state: 'READY',
                delivery_attachments: [updated ? newAttachment : oldAttachment],
                delivery_updatedAt: '2026-11-01T00:00:00.000Z',
              },
            ];
          },
        });

        const result = await repository.update(
          { id: 'delivery-id' },
          { attachments: [newAttachment] },
        );

        expect(result.affected).toBe(updateSucceeds ? 1 : 0);
        expect(fileRepository.find).toHaveBeenCalledTimes(1);
        expect(files.get('new-file')?.settings.isTemporaryFile).toBe(
          !updateSucceeds,
        );
        if (updateSucceeds) {
          expect(fileRepository.update).toHaveBeenCalledTimes(1);
          expect(fileRepository.softDelete).toHaveBeenCalledWith(['old-file']);
          expect(files.get('old-file')?.deletedAt).toBe('deleted');
          expect(emitDatabaseBatchEvent).toHaveBeenCalled();
          expect(getExecutedStatementKinds()).toEqual([
            'SELECT',
            'UPDATE',
            'SELECT',
          ]);
        } else {
          expect(fileRepository.update).not.toHaveBeenCalled();
          expect(fileRepository.softDelete).not.toHaveBeenCalled();
          expect(files.get('old-file')?.deletedAt).toBeUndefined();
          expect(emitDatabaseBatchEvent).not.toHaveBeenCalled();
          expect(getExecutedStatementKinds()).toEqual(['SELECT', 'UPDATE']);
        }
      },
    );
  });

  describe('on a repository that bypasses permission checks and skips events', () => {
    it('should update without reading a before-image', async () => {
      const { repository, getExecutedStatementKinds } = buildRepository({
        shouldSkipEventEmission: true,
      });

      await repository.update({ id: 'delivery-id' }, { state: 'SENT' });

      expect(getExecutedStatementKinds()).toEqual(['UPDATE']);
    });

    it.each([
      ['delete', 'DELETE'],
      ['softDelete', 'UPDATE'],
      ['restore', 'UPDATE'],
    ] as const)(
      'should %s without reading a before-image',
      async (method, statementKind) => {
        const { repository, getExecutedStatementKinds } = buildRepository({
          shouldSkipEventEmission: true,
        });

        await repository[method]({ id: 'delivery-id' });

        expect(getExecutedStatementKinds()).toEqual([statementKind]);
      },
    );

    it('should still read the before-image when an update touches a files field', async () => {
      const { repository, getExecutedStatementKinds } = buildRepository({
        shouldSkipEventEmission: true,
      });

      const result = await repository.update(
        { id: 'delivery-id' },
        { attachments: [] },
      );

      expect(result.affected).toBe(0);

      expect(getExecutedStatementKinds()).toEqual(['SELECT']);
    });
  });

  describe('on a repository that emits events', () => {
    it('should read the before- and after-image around an update', async () => {
      const { repository, getExecutedStatementKinds } = buildRepository({
        shouldSkipEventEmission: false,
        executeStatement: (statement) => [
          {
            delivery_id: 'delivery-id',
            delivery_state: statement.text.startsWith('UPDATE')
              ? 'SENT'
              : 'READY',
            delivery_updatedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      });

      await repository.update({ id: 'delivery-id' }, { state: 'SENT' });

      expect(getExecutedStatementKinds()).toEqual([
        'SELECT',
        'UPDATE',
        'SELECT',
      ]);
    });

    it('should read the before-image before a delete', async () => {
      const { repository, getExecutedStatementKinds } = buildRepository({
        shouldSkipEventEmission: false,
      });

      await repository.delete({ id: 'delivery-id' });

      expect(getExecutedStatementKinds()).toEqual(['SELECT', 'DELETE']);
    });
  });

  describe('on a permission-scoped repository that skips events', () => {
    it('should read the before-image before an update', async () => {
      const { repository, getExecutedStatementKinds } = buildRepository({
        shouldBypassPermissionChecks: false,
        shouldSkipEventEmission: true,
      });

      await repository.update({ id: 'delivery-id' }, { state: 'SENT' });

      expect(getExecutedStatementKinds()).toEqual(['SELECT', 'UPDATE']);
    });

    it('should read the before-image before a delete', async () => {
      const { repository, getExecutedStatementKinds } = buildRepository({
        shouldBypassPermissionChecks: false,
        shouldSkipEventEmission: true,
      });

      await repository.delete({ id: 'delivery-id' });

      expect(getExecutedStatementKinds()).toEqual(['SELECT', 'DELETE']);
    });
  });
});
