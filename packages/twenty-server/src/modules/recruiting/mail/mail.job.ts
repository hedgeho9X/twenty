/** Runs MIME archiving on the bounded recruiting queue, separate from document parsing. */
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import {
  RecruitingMailService,
  type RecruitingMailJobData,
} from './mail.service';

@Processor(MessageQueue.recruitingQueue)
/** Contains no mailbox mutation, SMTP or outbound message capability. */
export class RecruitingMailJob {
  constructor(private readonly mail: RecruitingMailService) {}
  /** Revalidates the original mailbox/operator identity before reading saved email bytes. */
  @Process('RecruitingMailJob')
  async handle(data: RecruitingMailJobData) {
    await this.mail.process(data);
  }
}
