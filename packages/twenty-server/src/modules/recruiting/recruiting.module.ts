import { ProcessingTasksService } from './intake/processing-tasks.service';
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
import { RecruitingActorService } from './auth/actor.service';
import { RecruitingController } from './api/recruiting.controller';
import { RecruitingRecordsService } from './records/records.service';
import { RecruitingParserService } from './files/parser.service';
import { RecruitingExtractorService } from './ai/extractor.service';
import { RecruitingIntakeService } from './intake/intake.service';
import { ResumeIngestJob } from './intake/resume-ingest.job';
import { RecruitingMatchingService } from './matching/matching.service';
import { RecruitingPairEvaluatorService } from './matching/pair-evaluator.service';
import { RecruitingMatchJob } from './matching/match.job';
import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { RecruitingRecordChangeListener } from './matching/record-change.listener';
import { RecruitingUploadService } from './files/upload.service';
import { FileUploadModule } from 'src/engine/core-modules/file/file-upload/file-upload.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { RecruitingUploadPermissionGuard } from './auth/upload-permission.guard';
import { RecruitingJobConfirmationService } from './intake/job-confirmation.service';
import { RecruitingDirectoryService } from './records/directory.service';
import { RecruitingToolAuthorizationService } from './auth/tool-authorization.service';
import { RecruitingOperationsTool } from './api/operations.tool';
import { RecruitingRequestLimitService } from './auth/request-limit.service';
import { RecruitingRequestLimitGuard } from './auth/request-limit.guard';
import { UsageLimitModule } from 'src/engine/core-modules/usage-limit/usage-limit.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { RecruitingDraftsService } from './drafts/drafts.service';
import { RecruitingDraftJob } from './drafts/draft.job';
import { RecruitingMailService } from './mail/mail.service';
import { RecruitingMailFilesService } from './mail/mail-files.service';
import { RecruitingMailJob } from './mail/mail.job';
import { RecruitingMailboxService } from './mail/mailbox.service';
import { RecruitingMailboxPollJob } from './mail/mailbox-poll.job';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessagingIMAPDriverModule } from 'src/modules/messaging/message-import-manager/drivers/imap/messaging-imap-driver.module';
import { RecruitingLockModule } from './shared/locking/lock.module';
import { RecruitingPortalService } from './portal/portal.service';
import { RecruitingActivityService } from './activities/activity.service';
import { RecruitingCandidateRecordsService } from './intake/candidate-records.service';
import { RecruitingPortalActionsService } from './portal/portal-actions.service';
import { RecruitingShareConsentService } from './portal/share-consent.service';
import { RecruitingPortalController } from './portal/portal.controller';

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
    ProcessingTasksService,
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
