/** Represents operator-extracted text without claiming that image-only content was recovered. */
import { createHash } from 'node:crypto';
import { type ParsedRecruitingMaterial } from '../../files/parser.service';

/** Retains the original candidate-owned file identity while explicitly marking text-only coverage. */
export const localTextMaterial = (
  file: { fileId: string; label: string },
  text: string,
): ParsedRecruitingMaterial => ({
  ...file,
  parserVersion: 'operator-text-recovery/v1',
  sourceHash: createHash('sha256').update(text).digest('hex'),
  requestId: `text-${file.fileId}`,
  format: 'text',
  status: 'partial',
  text,
  pages: 0,
  previews: [],
  coverage: '本地原件文字提取；不包含图片和扫描内容',
});
