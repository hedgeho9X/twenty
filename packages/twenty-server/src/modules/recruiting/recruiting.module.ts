/** Registers the recruiting domain without replacing native CRM records, authentication or models. */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoreEntityCacheModule } from 'src/engine/core-entity-cache/core-entity-cache.module';
import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { ApiKeyModule } from 'src/engine/core-modules/api-key/api-key.module';
import { FileModule } from 'src/engine/core-modules/file/file.module';
import { FilesFieldModule } from 'src/engine/core-modules/file/files-field/files-field.module';
import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { UserWorkspaceModule } from 'src/engine/core-modules/user-workspace/user-workspace.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { RecruitingActorService } from './recruiting-actor.service';
import { RecruitingController } from './recruiting.controller';
import { RecruitingRecordsService } from './recruiting-records.service';
import { RecruitingParserService } from './recruiting-parser.service';
import { RecruitingExtractorService } from './recruiting-extractor.service';
import { RecruitingIntakeService } from './recruiting-intake.service';
import { ResumeIngestJob } from './resume-ingest.job';
import { RecruitingMatchingService } from './recruiting-matching.service';
import { RecruitingPairEvaluatorService } from './recruiting-pair-evaluator.service';
import { RecruitingMatchJob } from './recruiting-match.job';
import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { RecruitingRecordChangeListener } from './recruiting-record-change.listener';
import { RecruitingUploadService } from './recruiting-upload.service';
import { FileUploadModule } from 'src/engine/core-modules/file/file-upload/file-upload.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { RecruitingUploadPermissionGuard } from './recruiting-upload-permission.guard';
import { RecruitingJobConfirmationService } from './recruiting-job-confirmation.service';
import { RecruitingDirectoryService } from './recruiting-directory.service';
import { RecruitingToolAuthorizationService } from './recruiting-tool-authorization.service';
import { RecruitingOperationsTool } from './recruiting-operations.tool';
import { RecruitingRequestLimitService } from './recruiting-request-limit.service';
import { RecruitingRequestLimitGuard } from './recruiting-request-limit.guard';
import { UsageLimitModule } from 'src/engine/core-modules/usage-limit/usage-limit.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { RecruitingDraftsService } from './recruiting-drafts.service';
import { RecruitingDraftJob } from './recruiting-draft.job';
import { RecruitingMailService } from './recruiting-mail.service';
import { RecruitingMailFilesService } from './recruiting-mail-files.service';
import { RecruitingMailJob } from './recruiting-mail.job';
import { RecruitingMailboxService } from './recruiting-mailbox.service';
import { RecruitingMailboxPollJob } from './recruiting-mailbox-poll.job';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessagingIMAPDriverModule } from 'src/modules/messaging/message-import-manager/drivers/imap/messaging-imap-driver.module';
import { RecruitingLockModule } from './recruiting-lock.module';
import { RecruitingPortalService } from './recruiting-portal.service';
import { RecruitingActivityService } from './recruiting-activity.service';
import { RecruitingContractsService } from './recruiting-contracts.service';
import { RecruitingContractRecordsService } from './recruiting-contract-records.service';
import { RecruitingCandidateRecordsService } from './recruiting-candidate-records.service';
import { RecruitingPortalActionsService } from './recruiting-portal-actions.service';
import { RecruitingShareConsentService } from './recruiting-share-consent.service';
import { RecruitingPortalController } from './recruiting-portal.controller';

@Module({
  imports: [
    TypeORMModule,
    RecruitingLockModule,
    RecordCrudModule,
    ApiKeyModule,
    TokenModule,
    UserWorkspaceModule,
    CoreEntityCacheModule,
    WorkspaceCacheModule,
    WorkspaceCacheStorageModule,
    FileModule,
    FileUploadModule,
    PermissionsModule,
    UsageLimitModule,
    MessagingIMAPDriverModule,
    FilesFieldModule,
    TypeOrmModule.forFeature([
      ApiKeyEntity,
      FileEntity,
      ConnectedAccountEntity,
    ]),
  ],
  controllers: [RecruitingController, RecruitingPortalController],
  providers: [
    RecruitingActorService,
    RecruitingRecordsService,
    RecruitingParserService,
    RecruitingExtractorService,
    RecruitingIntakeService,
    RecruitingUploadService,
    RecruitingUploadPermissionGuard,
    RecruitingJobConfirmationService,
    RecruitingDirectoryService,
    RecruitingToolAuthorizationService,
    RecruitingOperationsTool,
    RecruitingRequestLimitService,
    RecruitingRequestLimitGuard,
    RecruitingDraftsService,
    RecruitingDraftJob,
    RecruitingMailService,
    RecruitingMailFilesService,
    RecruitingMailJob,
    RecruitingMailboxService,
    RecruitingMailboxPollJob,
    RecruitingPortalService,
    RecruitingActivityService,
    RecruitingContractsService,
    RecruitingContractRecordsService,
    RecruitingCandidateRecordsService,
    RecruitingPortalActionsService,
    RecruitingShareConsentService,
    ResumeIngestJob,
    RecruitingMatchingService,
    RecruitingPairEvaluatorService,
    RecruitingMatchJob,
    RecruitingRecordChangeListener,
    provideWorkspaceScopedRepository(ApiKeyEntity),
    provideWorkspaceScopedRepository(FileEntity),
    provideWorkspaceScopedRepository(ConnectedAccountEntity),
  ],
  exports: [RecruitingActorService, RecruitingRecordsService],
})
/** Keeps business integration in one feature module. */
export class RecruitingModule {}
