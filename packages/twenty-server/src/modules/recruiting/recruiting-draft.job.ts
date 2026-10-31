/** Dispatches draft generation through the existing bounded recruiting queue. */
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import {
  RecruitingDraftsService,
  type RecruitingDraftJobData,
} from './recruiting-drafts.service';

@Processor(MessageQueue.recruitingQueue)
/** Adds no independent service or automatic outbound communication. */
export class RecruitingDraftJob {
  constructor(private readonly drafts: RecruitingDraftsService) {}
  /** Revalidates queued identity in the shared draft service. */
  @Process('RecruitingDraftJob')
  async handle(data: RecruitingDraftJobData) {
    await this.drafts.process(data);
  }
}
