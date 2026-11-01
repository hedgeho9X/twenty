/** Shares only selected live job descriptions, never candidate records or internal recruitment notes. */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { z } from 'zod';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { RecruitingActorService } from '../auth/actor.service';
import { RecruitingRecordsService } from '../records/records.service';
import { recruitingText } from '../matching/domain/match-context';

const scopeSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(10),
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
  ) {}
  /** Creates a purpose-bound link after checking the publisher's current access to every selected job. */
  async create(context: WorkspaceAuthContext, jobIds: string[]) {
    const ids = [...new Set(jobIds)];
    if (!ids.length || ids.length > 10)
      throw new BadRequestException('请选择最多十个岗位');
    for (const id of ids) await this.records.one(context, 'recruitmentJob', id);
    const scope = scopeSchema.parse({
      jobIds: ids,
      actor: this.actors.capture(context),
    });
    const token = sign(scope, this.config.get('APP_SECRET'), {
      algorithm: 'HS256',
      audience: 'recruiting-job-page',
      issuer: 'twenty-recruiting',
      expiresIn: '7d',
    });
    return `${this.config.get('FRONTEND_URL').replace(/\/$/, '')}/job-introductions#access=${encodeURIComponent(token)}`;
  }
  /** Revalidates expiry, publisher permissions and live job state on every anonymous view. */
  async view(token: string) {
    let scope: z.infer<typeof scopeSchema>;
    try {
      if (token.length > 8192) throw new Error('oversized');
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
      if (job.jobStatus !== 'RECRUITING') continue;
      const company =
        typeof job.companyId === 'string'
          ? await this.records.one(context, 'company', job.companyId)
          : undefined;
      const profile = (job.recruitingProfile ?? {}) as Record<string, unknown>;
      jobs.push({
        id,
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
    return { jobs };
  }
}
