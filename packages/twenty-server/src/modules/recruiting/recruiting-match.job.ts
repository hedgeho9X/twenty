/** Processes a ranking run on its own queue independently of material ingestion. */
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import {
  RecruitingMatchingService,
  type RecruitingMatchJobData,
} from './recruiting-matching.service';

@Processor(MessageQueue.recruitingMatchQueue)
/** Limits simultaneous ranking runs globally; each run evaluates at most three pairs at once. */
export class RecruitingMatchJob {
  constructor(private readonly matching: RecruitingMatchingService) {}

  /** Delegates persistence, permissions and paid evaluation to the shared business service. */
  @Process('RecruitingMatchJob')
  async handle(data: RecruitingMatchJobData) {
    await this.matching.process(data);
  }
}
