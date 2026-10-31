/** Keeps candidate consent authoritative, snapshot-bound and revocable independently of CRM projection fields. */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4, v5 } from 'uuid';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  RecruitingRecordsService,
  type RecruitingRecord,
} from './recruiting-records.service';
import { portalShareSnapshot } from './domain/portal-profile';
import {
  buildJobMatchContext,
  contentVersion,
  recruitingText,
} from './domain/match-context';
import { evaluateRecruitingEligibility } from './domain/match-policy';
import {
  RecruitingActorService,
  type RecruitingActor,
} from './recruiting-actor.service';

/** All timestamps and identities come from the server and the verified portal invitation. */
type ConsentPayload = {
  version: 1;
  grantId: string;
  inviteId: string;
  companyId: string;
  jobVersion: string;
  profileHash: string;
  snapshot: ReturnType<typeof portalShareSnapshot>['snapshot'];
  confirmedAt: string;
  withdrawnAt?: string;
  termsVersion: 'candidate-sharing-v1';
  events: { choice: string; at: string; inviteId: string }[];
};

@Injectable()
/** Generic person.candidatePortalState edits cannot grant access; only signed consent records do. */
export class RecruitingShareConsentService {
  constructor(
    private readonly records: RecruitingRecordsService,
    private readonly actors: RecruitingActorService,
  ) {}

  /** Exposes candidate-visible job facts while withholding company recruitment preferences and operator notes. */
  async job(context: WorkspaceAuthContext, jobId: string) {
    const job = await this.records.one(context, 'recruitmentJob', jobId);
    const company =
      typeof job.companyId === 'string'
        ? await this.records.one(context, 'company', job.companyId)
        : undefined;
    const prepared = buildJobMatchContext(job, company);
    const view = {
      jobId: job.id,
      title: String(job.name ?? ''),
      companyId: company?.id,
      companyName: company?.name ?? '',
      companyDescription: recruitingText(company?.recruitingDescription),
      description:
        recruitingText(job.candidatePortalDescription) ||
        recruitingText(job.jobDescription),
      recruiting:
        evaluateRecruitingEligibility({}, prepared.eligibility).status !==
          'excluded' && !prepared.issue,
    };
    return { view, jobVersion: contentVersion(view) };
  }

  /** Confirms exactly the visible snapshot; callers serialize writes under the candidate's portal lock. */
  async record(
    context: WorkspaceAuthContext,
    candidate: RecruitingRecord,
    inviteId: string,
    jobId: string,
    choice: 'CONFIRM' | 'WITHDRAW',
    fileIds: string[],
  ) {
    const id = this.id(context.workspace.id, candidate.id, jobId);
    const existing = await this.optional(context, id);
    const previous = existing?.payload as ConsentPayload | undefined;
    const at = new Date().toISOString();
    if (choice === 'WITHDRAW') {
      const payload = {
        ...(previous ?? {
          version: 1,
          termsVersion: 'candidate-sharing-v1',
          inviteId,
        }),
        withdrawnAt: at,
        events: [...(previous?.events ?? []), { choice, at, inviteId }].slice(
          -100,
        ),
      };
      const data = {
        name: '候选人已撤回分享',
        candidateId: candidate.id,
        jobId,
        status: 'WITHDRAWN',
        payload,
      };
      if (existing)
        await this.records.update(context, 'recruitingShareConsent', id, data);
      else
        await this.records.create(context, 'recruitingShareConsent', {
          id,
          ...data,
        });
      return { jobId, status: 'WITHDRAWN', at };
    }
    const job = await this.job(context, jobId);
    if (!job.view.recruiting || !job.view.companyId)
      throw new BadRequestException('岗位或公司当前不可推荐，请核对后再确认');
    let exported;
    try {
      exported = portalShareSnapshot(candidate, fileIds);
    } catch {
      throw new BadRequestException('所选简历不属于当前候选人或已被移除');
    }
    const payload: ConsentPayload = {
      version: 1,
      grantId:
        previous &&
        existing?.status === 'CONFIRMED' &&
        previous.profileHash === exported.profileHash &&
        previous.jobVersion === job.jobVersion &&
        previous.inviteId === inviteId
          ? previous.grantId
          : v4(),
      inviteId,
      companyId: job.view.companyId,
      jobVersion: job.jobVersion,
      ...exported,
      confirmedAt: at,
      termsVersion: 'candidate-sharing-v1',
      events: [...(previous?.events ?? []), { choice, at, inviteId }].slice(
        -100,
      ),
    };
    const data = {
      name: '候选人已确认分享',
      candidateId: candidate.id,
      jobId,
      status: 'CONFIRMED',
      payload,
    };
    if (existing)
      await this.records.update(context, 'recruitingShareConsent', id, data);
    else
      await this.records.create(context, 'recruitingShareConsent', {
        id,
        ...data,
      });
    return { jobId, status: 'CONFIRMED', at };
  }

  /** Rechecks consent, current native access and exact public data on every company view or download. */
  async assertAllowed(
    context: WorkspaceAuthContext,
    candidateId: string,
    jobId: string,
  ) {
    const candidate = await this.records.one(context, 'person', candidateId);
    const consent = await this.optional(
      context,
      this.id(context.workspace.id, candidateId, jobId),
    );
    if (!consent || consent.status !== 'CONFIRMED')
      throw new ForbiddenException('候选人尚未确认或已撤回分享');
    const payload = consent.payload as ConsentPayload;
    const origin = await this.records.one(
      context,
      'recruitingPortalInvite',
      payload.inviteId,
    );
    if (origin.status !== 'ACTIVE' || Number(origin.expiresAt) <= Date.now())
      throw new ForbiddenException('候选人授权入口已失效，请重新确认');
    const originActor = (origin.payload as { actor: RecruitingActor }).actor;
    const originContext = await this.actors.resolve(originActor);
    await this.records.one(originContext, 'person', candidateId);
    const job = await this.job(context, jobId);
    let current;
    try {
      current = portalShareSnapshot(
        candidate,
        payload.snapshot.files.map((file) => file.fileId),
      );
    } catch {
      throw new ForbiddenException('分享资料已变化，请候选人重新确认');
    }
    if (
      !job.view.recruiting ||
      job.view.companyId !== payload.companyId ||
      job.jobVersion !== payload.jobVersion ||
      current.profileHash !== payload.profileHash
    )
      throw new ForbiddenException('资料或岗位已变化，请候选人重新确认分享');
    return {
      grantId: payload.grantId,
      sourceExpiresAt: Number(origin.expiresAt),
      snapshot: payload.snapshot,
      companyId: payload.companyId,
      confirmedAt: payload.confirmedAt,
      termsVersion: payload.termsVersion,
    };
  }

  /** Reports status without revealing a previously consented private snapshot to another caller. */
  async status(
    context: WorkspaceAuthContext,
    candidateId: string,
    jobId: string,
  ) {
    const consent = await this.optional(
      context,
      this.id(context.workspace.id, candidateId, jobId),
    );
    if (!consent) return { jobId, status: 'UNCONFIRMED', valid: false };
    let valid = false;
    try {
      await this.assertAllowed(context, candidateId, jobId);
      valid = true;
    } catch (error) {
      if (
        !(error instanceof ForbiddenException) &&
        !(error instanceof NotFoundException)
      )
        throw error;
    }
    return { jobId, status: consent.status, valid };
  }
  /** Keeps one current authorization decision per candidate/job across all invitation links. */
  private id(workspaceId: string, candidateId: string, jobId: string) {
    return v5(
      `${workspaceId}:candidate-consent:${candidateId}:${jobId}`,
      v5.URL,
    );
  }
  /** Absence remains different from a permission or storage failure. */
  private async optional(context: WorkspaceAuthContext, id: string) {
    try {
      return await this.records.one(context, 'recruitingShareConsent', id);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
}
