/** Runs the same owner-scoped IMAP acquisition and archival boundary on the existing recruiting queue. */
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import {
  RecruitingMailboxService,
  type RecruitingMailboxPollData,
} from './recruiting-mailbox.service';
import { RECRUITING_MAILBOX_POLL_JOB } from './recruiting-mailbox-poll-job.constant';

@Processor(MessageQueue.recruitingQueue)
/** Carries stable actor references only; credentials remain in the official IMAP provider. */
export class RecruitingMailboxPollJob {
  constructor(private readonly mailboxes: RecruitingMailboxService) {}
  /** Verifies the current opt-in and actor on every repeat before any network access. */
  @Process(RECRUITING_MAILBOX_POLL_JOB)
  async handle(data: RecruitingMailboxPollData) {
    await this.mailboxes.poll(data);
  }
}
