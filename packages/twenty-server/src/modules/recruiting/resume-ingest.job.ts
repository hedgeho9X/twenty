/** Dispatches ingestion through the native durable queue with its workspace-scoped actor. */
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import {
  RecruitingIntakeService,
  type RecruitingIntakeJobData,
} from './recruiting-intake.service';

@Processor(MessageQueue.recruitingQueue)
/** Reuses the native worker lifecycle, retry bookkeeping and global concurrency limit. */
export class ResumeIngestJob {
  constructor(private readonly intake: RecruitingIntakeService) {}

  /** Performs no direct model or database writes outside the shared ingestion service. */
  @Process('ResumeIngestJob')
  async handle(data: RecruitingIntakeJobData) {
    await this.intake.process(data);
  }
}
