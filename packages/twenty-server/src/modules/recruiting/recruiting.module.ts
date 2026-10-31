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
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';

@Module({
  imports: [
    RecordCrudModule,
    ApiKeyModule,
    TokenModule,
    UserWorkspaceModule,
    CoreEntityCacheModule,
    WorkspaceCacheModule,
    WorkspaceCacheStorageModule,
    FileModule,
    FilesFieldModule,
    TypeOrmModule.forFeature([ApiKeyEntity, FileEntity]),
  ],
  controllers: [RecruitingController],
  providers: [
    RecruitingActorService,
    RecruitingRecordsService,
    RecruitingParserService,
    RecruitingExtractorService,
    RecruitingIntakeService,
    ResumeIngestJob,
    provideWorkspaceScopedRepository(ApiKeyEntity),
    provideWorkspaceScopedRepository(FileEntity),
  ],
  exports: [RecruitingActorService, RecruitingRecordsService],
})
/** Keeps business integration in one feature module. */
export class RecruitingModule {}
