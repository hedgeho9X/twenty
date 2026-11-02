/** Creates revocable public projections and authenticated match-source references. */
import { randomBytes } from 'node:crypto';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { z } from 'zod';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { RecruitingActorService } from '../auth/actor.service';
import { RecruitingRecordsService } from '../records/records.service';
import {
  recruitingText,
  buildCandidateMatchContext,
} from '../matching/domain/match-context';

const scopeSchema = z.object({
  jobIds: z.array(z.string().uuid()).max(10),
  candidateIds: z.array(z.string().uuid()).max(10).default([]),
  actor: z.object({
    workspaceId: z.string().uuid(),
    userWorkspaceId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
    applicationId: z.string().uuid().optional(),
    viaApplicationId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
  }),
});
/** Issues and verifies short-lived links scoped to a selected set of live jobs. */
@Injectable()
export class RecruitingJobPageService {
  constructor(
    private readonly config: TwentyConfigService,
    private readonly actors: RecruitingActorService,
    private readonly records: RecruitingRecordsService,
    @InjectCacheStorage(CacheStorageNamespace.EngineAuthSession)
    private readonly links: CacheStorageService,
  ) {}
  /** Creates a purpose-bound link after checking the publisher's current access to every selected job. */
  async create(
    context: WorkspaceAuthContext,
    jobIds: string[],
    candidateIds: string[] = [],
    matchRunId?: string,
  ) {
    const ids = [...new Set(jobIds)];
    if (
      (!ids.length && !candidateIds.length) ||
      ids.length > 10 ||
      candidateIds.length > 10
    )
      throw new BadRequestException('请选择最多十个岗位');
    for (const id of ids) await this.records.one(context, 'recruitmentJob', id);
    for (const id of candidateIds) {
      const person = await this.records.one(context, 'person', id);
      if (
        !Array.isArray(person.contactRoles) ||
        !person.contactRoles.includes('CANDIDATE')
      )
        throw new BadRequestException('请选择候选人');
    }
    const source = matchRunId
      ? await this.matchSource(context, matchRunId, ids, candidateIds)
      : undefined;
    const scope = scopeSchema.parse({
      jobIds: ids,
      candidateIds: [...new Set(candidateIds)],
      actor: this.actors.capture(context),
    });
    const token = sign(scope, this.config.get('APP_SECRET'), {
      algorithm: 'HS256',
      audience: 'recruiting-job-page',
      issuer: 'twenty-recruiting',
      expiresIn: '7d',
    });
    let key = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomBytes(8).toString('base64url').slice(0, 10);
      if (
        await this.links.setIfAbsent(
          `recruiting-job-page:${candidate}`,
          token,
          7 * 24 * 60 * 60 * 1000,
        )
      ) {
        key = candidate;
        break;
      }
    }
    if (!key) throw new BadRequestException('暂时无法生成分享链接，请重试');
    await this.links.set(
      `recruiting-share-meta:${key}`,
      {
        key,
        jobIds: ids,
        candidateIds: scope.candidateIds,
        createdAt: new Date().toISOString(),
        source,
        owner: this.owner(context),
      },
      7 * 24 * 60 * 60 * 1000,
    );
    await this.links.setAdd(`recruiting-share-index:${this.owner(context)}`, [
      key,
    ]);
    return `${this.config.get('FRONTEND_URL').replace(/\/$/, '')}/r/${key}`;
  }
  /** Indexes links by their creator; revocation deletes the resolving token immediately. */
  private owner(context: WorkspaceAuthContext) {
    const actor = this.actors.capture(context);
    return `${actor.workspaceId}:${actor.userWorkspaceId ?? actor.apiKeyId ?? actor.applicationId}`;
  }
  async list(context: WorkspaceAuthContext) {
    const keys = await this.links.setMembers(
      `recruiting-share-index:${this.owner(context)}`,
    );
    const rows = await Promise.all(
      keys.map((key) =>
        this.links.get<{
          key: string;
          owner: string;
          jobIds: string[];
          candidateIds: string[];
          createdAt: string;
          source?: {
            matchRunId: string;
            subjectId: string;
            subjectKind: string;
          };
        }>(`recruiting-share-meta:${key}`),
      ),
    );
    const result = [];
    for (const row of rows) {
      if (!row || row.owner !== this.owner(context)) continue;
      const jobs = await Promise.all(
        row.jobIds.map(async (id) => {
          const job = await this.records.one(context, 'recruitmentJob', id);
          return { name: job.name, status: job.jobStatus };
        }),
      );
      const candidates = await Promise.all(
        row.candidateIds.map(async (id) => {
          const person = await this.records.one(context, 'person', id);
          return { name: person.name };
        }),
      );
      const subject = row.source
        ? await this.subject(context, row.source)
        : undefined;
      result.push({
        ...row,
        jobs,
        candidates,
        subjectLabel: subject
          ? this.recordLabel(subject.name)
          : this.recordLabel(candidates[0]?.name ?? jobs[0]?.name) ||
            '分享资料',
        matchRunId: subject ? row.source?.matchRunId : undefined,
        url: `${this.config.get('FRONTEND_URL').replace(/\/$/, '')}/r/${row.key}`,
      });
    }
    return result;
  }

  /** A removed source leaves an older share listable; other access failures still surface. */
  private async subject(
    context: WorkspaceAuthContext,
    source: { subjectKind: string; subjectId: string },
  ) {
    try {
      return await this.records.one(
        context,
        source.subjectKind,
        source.subjectId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  /** Accepts provenance only from a readable run containing the selected records. */
  private async matchSource(
    context: WorkspaceAuthContext,
    matchRunId: string,
    jobIds: string[],
    candidateIds: string[],
  ) {
    const run = await this.records.one(
      context,
      'recruitingMatchRun',
      matchRunId,
    );
    const payload = z
      .object({
        input: z.object({
          direction: z.enum(['CANDIDATE_TO_JOBS', 'JOB_TO_CANDIDATES', 'PAIR']),
          subjectId: z.string().uuid(),
        }),
        results: z.array(
          z.object({
            jobId: z.string().uuid(),
            candidateId: z.string().uuid(),
          }),
        ),
      })
      .parse(run.payload);
    const allowedJobs = new Set(payload.results.map((row) => row.jobId));
    const allowedCandidates = new Set(
      payload.results.map((row) => row.candidateId),
    );
    if (
      jobIds.some((id) => !allowedJobs.has(id)) ||
      candidateIds.some((id) => !allowedCandidates.has(id))
    )
      throw new BadRequestException('分享资料不属于此匹配结果');
    return {
      matchRunId,
      subjectId: payload.input.subjectId,
      subjectKind:
        payload.input.direction === 'JOB_TO_CANDIDATES'
          ? 'recruitmentJob'
          : 'person',
    };
  }

  /** Formats native composite names without exposing contact fields. */
  private recordLabel(name: unknown): string {
    if (typeof name === 'string') return name;
    if (!name || typeof name !== 'object') return '';
    const value = name as { firstName?: string; lastName?: string };
    return [value.firstName, value.lastName].filter(Boolean).join(' ');
  }

  async revoke(context: WorkspaceAuthContext, key: string) {
    const meta = await this.links.get<{ owner: string }>(
      `recruiting-share-meta:${key}`,
    );
    if (!meta || meta.owner !== this.owner(context))
      throw new ForbiddenException('无权撤销此链接');
    await this.links.del(`recruiting-job-page:${key}`);
    await this.links.del(`recruiting-share-meta:${key}`);
    await this.links.setRemove(
      `recruiting-share-index:${this.owner(context)}`,
      [key],
    );
    return { deleted: true };
  }

  /** Revalidates expiry, publisher permissions and live job state on every anonymous view. */
  async view(token: string) {
    let scope: z.infer<typeof scopeSchema>;
    try {
      if (token.length > 8192) throw new Error('oversized');
      if (/^[A-Za-z0-9_-]{10,24}$/.test(token)) {
        const resolved = await this.links.get<string>(
          `recruiting-job-page:${token}`,
        );
        if (!resolved) throw new Error('expired');
        token = resolved;
      }
      scope = scopeSchema.parse(
        verify(token, this.config.get('APP_SECRET'), {
          algorithms: ['HS256'],
          audience: 'recruiting-job-page',
          issuer: 'twenty-recruiting',
        }),
      );
    } catch {
      throw new ForbiddenException('岗位介绍链接已失效');
    }
    const context = await this.actors.resolve(scope.actor);
    const jobs = [];
    for (const id of scope.jobIds) {
      const job = await this.records.one(context, 'recruitmentJob', id);

      const company =
        typeof job.companyId === 'string'
          ? await this.records.one(context, 'company', job.companyId)
          : undefined;
      const profile = (job.recruitingProfile ?? {}) as Record<string, unknown>;
      jobs.push({
        id,
        status: job.jobStatus,
        title: job.name,
        company: company?.name ?? '',
        description: recruitingText(job.jobDescription),
        locations: Array.isArray(profile.locations) ? profile.locations : [],
        employmentTypes: Array.isArray(profile.employmentTypes)
          ? profile.employmentTypes
          : [],
        workModes: Array.isArray(profile.workModes) ? profile.workModes : [],
      });
    }
    const candidates = [];
    for (const id of scope.candidateIds) {
      const person = await this.records.one(context, 'person', id);
      const profile = buildCandidateMatchContext(person).context;
      candidates.push({
        name: person.name,
        summary: profile.summary,
        skills: profile.skills,
        experience: profile.experience,
        education: profile.education,
        expectedRoles: profile.expectedRoles,
      });
    }
    return { jobs, candidates };
  }
}
