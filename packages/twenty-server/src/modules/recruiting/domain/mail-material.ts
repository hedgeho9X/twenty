/** Expands bounded MIME input into complete archive artifacts without executing HTML or discarding inline resources. */
import { createHash } from 'node:crypto';
import PostalMime from 'postal-mime';

/** Bytes are uploaded through the native file lifecycle before entering persistent archive metadata. */
export type RecruitingMailArtifact = {
  key: string;
  label: string;
  originalFilename?: string | null;
  kind: 'raw' | 'metadata' | 'text' | 'html' | 'attachment';
  content: Buffer;
  sha256: string;
  mimeType: string;
  inline: boolean;
  contentId?: string;
  suggestedResume: boolean;
};

/** Keeps the original filename separately while preventing paths and control characters from becoming storage names. */
const safeLabel = (label: string, index: number) =>
  label
    .replace(/[\\/\x00-\x1f\x7f]/g, '_')
    .slice(-400)
    .trim() || `attachment-${index}`;

/** Preserves complete headers, bodies, envelope fields, attachments and nested-message bytes in the original EML. */
export const expandRecruitingMail = async (raw: Buffer) => {
  if (!raw.length || raw.length > 50 * 1024 * 1024)
    throw new Error('邮件原文必须在50MB以内');
  const parsed = await PostalMime.parse(raw, {
    attachmentEncoding: 'arraybuffer',
    maxNestingDepth: 30,
    maxHeadersSize: 1024 * 1024,
    rfc822Attachments: true,
  });
  if (parsed.attachments.length > 500)
    throw new Error('邮件附件超过自动展开上限，完整EML仍已归档');
  const sha = (content: Buffer) =>
    createHash('sha256').update(content).digest('hex');
  const artifacts: RecruitingMailArtifact[] = [];
  const add = (value: Omit<RecruitingMailArtifact, 'key' | 'sha256'>) =>
    artifacts.push({
      ...value,
      key: `${artifacts.length}:${sha(value.content)}`,
      sha256: sha(value.content),
    });
  const metadata = {
    messageId: parsed.messageId,
    subject: parsed.subject,
    date: parsed.date,
    from: parsed.from,
    sender: parsed.sender,
    replyTo: parsed.replyTo,
    to: parsed.to,
    cc: parsed.cc,
    bcc: parsed.bcc,
    deliveredTo: parsed.deliveredTo,
    returnPath: parsed.returnPath,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
    headers: parsed.headers,
    headerLines: parsed.headerLines,
    attachments: parsed.attachments.map(
      ({
        filename,
        mimeType,
        disposition,
        contentId,
        related,
        description,
      }) => ({
        filename,
        mimeType,
        disposition,
        contentId,
        related,
        description,
      }),
    ),
  };
  add({
    label: 'original.eml',
    kind: 'raw',
    content: raw,
    mimeType: 'message/rfc822',
    inline: false,
    suggestedResume: false,
  });
  add({
    label: 'mail-metadata.json',
    kind: 'metadata',
    content: Buffer.from(JSON.stringify(metadata)),
    mimeType: 'application/json',
    inline: false,
    suggestedResume: false,
  });
  if (parsed.text)
    add({
      label: 'mail-body.txt',
      kind: 'text',
      content: Buffer.from(parsed.text),
      mimeType: 'text/plain',
      inline: false,
      suggestedResume: false,
    });
  if (parsed.html)
    add({
      label: 'mail-body.html',
      kind: 'html',
      content: Buffer.from(parsed.html),
      mimeType: 'text/html',
      inline: false,
      suggestedResume: false,
    });
  for (const [index, attachment] of parsed.attachments.entries()) {
    const content =
      typeof attachment.content === 'string'
        ? Buffer.from(
            attachment.content,
            attachment.encoding === 'base64' ? 'base64' : 'utf8',
          )
        : attachment.content instanceof Uint8Array
          ? Buffer.from(attachment.content)
          : Buffer.from(new Uint8Array(attachment.content));
    const inline =
      attachment.disposition === 'inline' || Boolean(attachment.related);
    const label = safeLabel(attachment.filename ?? '', index + 1);
    add({
      label,
      originalFilename: attachment.filename,
      kind: 'attachment',
      content,
      mimeType: attachment.mimeType,
      inline,
      contentId: attachment.contentId,
      suggestedResume:
        !inline &&
        /\.(?:pdf|docx?|png|jpe?g|webp|heic|tiff?|bmp|txt|html?|md|markdown)$/i.test(
          label,
        ),
    });
  }
  return {
    metadata,
    artifacts,
    sourceHash: sha(raw),
    parserVersion: 'postal-mime-complete-v1',
  };
};
