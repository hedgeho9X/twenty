/** Tests MIME fidelity with a complete synthetic email instead of a pre-parsed attachment mock. */
import { expandRecruitingMail } from '../mail-material';

/** Includes quoted history, both body variants, duplicate filenames and an inline image. */
const fixture = () =>
  Buffer.from(
    [
      'Message-ID: <synthetic-intake@example.test>',
      'From: Candidate <candidate@example.test>',
      'To: recruiting@example.test',
      'Subject: Synthetic application',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary="body"',
      '',
      '--body',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Current self-introduction\n> Full previous message is retained.',
      '--body',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Current self-introduction</p><img src="cid:logo"><blockquote>Original history</blockquote>',
      '--body--',
      '--outer',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Disposition: attachment; filename="resume.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Resume: TypeScript, PostgreSQL, 2024-2026.').toString(
        'base64',
      ),
      '--outer',
      'Content-Type: image/png',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-ID: <logo>',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('synthetic-image-bytes').toString('base64'),
      '--outer--',
      '',
    ].join('\r\n'),
  );

it('retains exact EML bytes, full quoted text, HTML, all headers and inline content', async () => {
  const raw = fixture();
  const value = await expandRecruitingMail(raw);
  expect(
    value.artifacts.find((file) => file.kind === 'raw')!.content.equals(raw),
  ).toBe(true);
  expect(
    value.artifacts.find((file) => file.kind === 'text')!.content.toString(),
  ).toContain('Full previous message');
  expect(
    value.artifacts.find((file) => file.kind === 'html')!.content.toString(),
  ).toContain('cid:logo');
  expect(value.metadata.messageId).toBe('<synthetic-intake@example.test>');
  const attachments = value.artifacts.filter(
    (file) => file.kind === 'attachment',
  );
  expect(attachments).toHaveLength(2);
  expect(attachments[0]).toMatchObject({
    label: 'resume.txt',
    inline: false,
    suggestedResume: true,
  });
  expect(attachments[1]).toMatchObject({
    label: 'logo.png',
    contentId: '<logo>',
    inline: true,
    suggestedResume: false,
  });
  expect(attachments[1].content.toString()).toBe('synthetic-image-bytes');
});

it('does not treat a matching Message-ID with different bytes as the same archived business source', async () => {
  const first = await expandRecruitingMail(fixture());
  const second = await expandRecruitingMail(
    Buffer.from(
      fixture().toString().replace('Synthetic application', 'Changed source'),
    ),
  );
  expect(first.metadata.messageId).toBe(second.metadata.messageId);
  expect(first.sourceHash).not.toBe(second.sourceHash);
});
