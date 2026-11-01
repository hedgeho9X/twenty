/** Executes candidate-scoped public actions while keeping native authentication and unrelated CRM data private. */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isPlainObject } from 'twenty-shared/utils';
import {
  RecruitingPortalService,
  type PortalSession,
} from './portal.service';
import { RecruitingShareConsentService } from './share-consent.service';
import { RecruitingRecordsService } from '../records/records.service';
import { RecruitingUploadService } from '../files/upload.service';
import { RecruitingParserService } from '../files/parser.service';
import { RecruitingIntakeService } from '../intake/intake.service';
import { RecruitingMatchingService } from '../matching/matching.service';
import {
  portalActionSchema,
  readPortalSelfProfile,
} from './domain/portal-schemas';
import {
  portalCandidateFiles,
  publicCandidateProfile,
} from './domain/portal-profile';

/** Binary responses are explicit so untrusted HTML can never be serialized or opened as a CRM page. */
export type PortalActionResponse =
  | { kind: 'json'; data: object }
  | { kind: 'download'; label: string; bytes: Buffer };

@Injectable()
/** No action accepts a candidate or workspace ID from the anonymous caller. */
export class RecruitingPortalActionsService {
  constructor(
    private readonly portals: RecruitingPortalService,
    private readonly consents: RecruitingShareConsentService,
    private readonly records: RecruitingRecordsService,
    private readonly uploads: RecruitingUploadService,
    private readonly parser: RecruitingParserService,
    private readonly intakes: RecruitingIntakeService,
    private readonly matching: RecruitingMatchingService,
  ) {}

  /** Resolves the scoped capability before dispatching any record, file or queue operation. */
  async execute(value: unknown): Promise<PortalActionResponse> {
    if (!isPlainObject(value) || typeof value.token !== 'string')
      throw new ForbiddenException('链接已失效或当前无权访问');
    const { token, ...operation } = value;
    const parsed = portalActionSchema.safeParse(operation);
    if (!parsed.success) throw new BadRequestException('请核对表单内容后重试');
    const session = await this.portals.resolve(token);
    const input = parsed.data;
    if (
      session.invite.kind === 'COMPANY' &&
      !['view', 'download'].includes(input.action)
    )
      throw new ForbiddenException('此链接仅可查看已确认的推荐资料');
    if (input.action === 'view')
      return { kind: 'json', data: await this.view(session) };
    if (input.action === 'download')
      return this.download(session, input.fileId);
    if (input.action === 'intake_progress') {
      if (!session.payload.intakeIds.includes(input.intakeId))
        throw new ForbiddenException('此处理任务不属于当前入口');
      const intake = await this.intakes.one(session.context, input.intakeId);
      return {
        kind: 'json',
        data: {
          intakeId: intake.intakeId,
          state: intake.state,
          stage: intake.stage,
          error: intake.error,
        },
      };
    }
    const data = await this.portals.mutate(session, async (current) => {
      switch (input.action) {
        case 'profile_save': {
          await this.records.update(
            current.context,
            'person',
            current.candidate.id,
            {
              candidatePortalProfile: {
                version: 1,
                profile: input.profile,
                sourceInviteId: current.invite.id,
                updatedAt: new Date().toISOString(),
              },
            },
          );
          try {
            await this.matching.submitForRecord(
              current.context,
              'person',
              current.candidate.id,
            );
          } catch {
            return { saved: true, matchingStatus: 'NEEDS_RETRY' };
          }
          return { saved: true, matchingStatus: 'QUEUED' };
        }
        case 'upload_target': {
          if (
            current.payload.uploads.length >= 10 ||
            current.payload.uploads.reduce(
              (sum, file) => sum + file.size,
              input.size,
            ) >
              100 * 1024 * 1024
          )
            throw new BadRequestException(
              '此入口已达到文件数量或100MB总量上限，请联系运营人员',
            );
          const target = await this.uploads.target(current.context, {
            filename: input.filename,
            size: input.size,
          });
          const payload = {
            ...current.payload,
            uploads: [
              ...current.payload.uploads,
              {
                fileId: target.fileId,
                label: input.filename,
                uploadReceipt: target.uploadReceipt,
                size: input.size,
              },
            ],
          };
          await this.records.update(
            current.context,
            'recruitingPortalInvite',
            current.invite.id,
            { payload },
          );
          return {
            fileId: target.fileId,
            uploadUrl: target.uploadUrl,
            contentType: target.contentType,
          };
        }
        case 'upload_complete': {
          const file = current.payload.uploads.find(
            (entry) => entry.fileId === input.fileId,
          );
          if (!file) throw new ForbiddenException('此文件不属于当前入口');
          if (!file.completed) {
            await this.uploads.complete(current.context, {
              uploadReceipt: file.uploadReceipt,
            });
            const payload = {
              ...current.payload,
              uploads: current.payload.uploads.map((entry) =>
                entry.fileId === file.fileId
                  ? { ...entry, completed: true }
                  : entry,
              ),
            };
            await this.records.update(
              current.context,
              'recruitingPortalInvite',
              current.invite.id,
              { payload },
            );
          }
          return { fileId: file.fileId, label: file.label, completed: true };
        }
        case 'resume_submit': {
          const files = await this.uploads.fromPortalInvitation(
            current.context,
            current.invite.id,
            input.fileIds,
          );
          const intake = await this.intakes.submit(current.context, {
            kind: 'CANDIDATE',
            candidateId: current.candidate.id,
            files,
            note: input.note,
            source: 'api',
            sourceId: current.invite.id,
            idempotencyKey: `portal:${current.invite.id}:${input.idempotencyKey}`,
          });
          if (!current.payload.intakeIds.includes(intake.intakeId))
            await this.records.update(
              current.context,
              'recruitingPortalInvite',
              current.invite.id,
              {
                payload: {
                  ...current.payload,
                  intakeIds: [...current.payload.intakeIds, intake.intakeId],
                },
              },
            );
          return {
            intakeId: intake.intakeId,
            state: intake.state,
            stage: intake.stage,
          };
        }
        case 'intent': {
          this.allowedJob(current, input.jobId);
          await this.records.update(
            current.context,
            'recruitingPortalInvite',
            current.invite.id,
            {
              payload: {
                ...current.payload,
                intents: {
                  ...current.payload.intents,
                  [input.jobId]: input.interested,
                },
              },
            },
          );
          return { jobId: input.jobId, interested: input.interested };
        }
        case 'consent': {
          this.allowedJob(current, input.jobId);
          return this.consents.record(
            current.context,
            current.candidate,
            current.invite.id,
            input.jobId,
            input.choice,
            input.fileIds,
          );
        }
      }
    });
    return { kind: 'json', data };
  }

  /** Shows only selected job context and explicit share status, never private operator notes or matching scores. */
  private async view(session: PortalSession) {
    if (session.invite.kind === 'COMPANY') {
      const shared = await this.companySnapshot(session);
      const job = await this.consents.job(
        session.context,
        session.payload.jobIds[0],
      );
      return {
        kind: 'COMPANY',
        profile: shared.snapshot.profile,
        files: shared.snapshot.files,
        job: job.view,
        confirmedAt: shared.confirmedAt,
        expiresAt: Number(session.invite.expiresAt),
      };
    }
    const jobs = [];
    for (const id of session.payload.jobIds) {
      try {
        const job = await this.consents.job(session.context, id);
        jobs.push({
          ...job.view,
          consent: await this.consents.status(
            session.context,
            session.candidate.id,
            id,
          ),
          interested: session.payload.intents?.[id],
        });
      } catch {
        jobs.push({
          jobId: id,
          title: '岗位当前不可用',
          recruiting: false,
          unavailable: true,
        });
      }
    }
    return {
      kind: 'CANDIDATE',
      profile: publicCandidateProfile(session.candidate),
      selfProfile: readPortalSelfProfile(
        session.candidate.candidatePortalProfile,
      ),
      files: portalCandidateFiles(session.candidate),
      jobs,
      expiresAt: Number(session.invite.expiresAt),
    };
  }

  /** Serves only a current candidate file or a still-consented company snapshot file. */
  private async download(
    session: PortalSession,
    fileId: string,
  ): Promise<PortalActionResponse> {
    const files =
      session.invite.kind === 'COMPANY'
        ? (await this.companySnapshot(session)).snapshot.files
        : portalCandidateFiles(session.candidate);
    const file = files.find((entry) => entry.fileId === fileId);
    if (!file) throw new ForbiddenException('此文件不在当前可访问资料中');
    return {
      kind: 'download',
      label: file.label,
      bytes: await this.parser.original(session.payload.actor, file.fileId),
    };
  }
  /** A candidate cannot confirm, withdraw or express intent for a job outside the invitation. */
  private allowedJob(session: PortalSession, id: string) {
    if (!session.payload.jobIds.includes(id))
      throw new ForbiddenException('岗位不属于当前入口');
  }

  /** Old company links cannot revive when a withdrawn consent is later confirmed as a new grant. */
  private async companySnapshot(session: PortalSession) {
    const shared = await this.consents.assertAllowed(
      session.context,
      session.candidate.id,
      session.payload.jobIds[0],
    );
    if (shared.grantId !== session.payload.consentGrantId)
      throw new ForbiddenException('此推荐链接对应的分享授权已失效');
    return shared;
  }
}
