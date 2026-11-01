/** Plans complete Unicode text spans and page previews within a conservative multimodal budget. */
import { createHash } from 'node:crypto';

/** A planned part keeps stable identities for durable generation checkpoints. */
export type RecruitingMaterialPart = {
  key: string;
  text: string;
  previews: { materialIndex: number; name: string }[];
};

/** Splits without deleting separators or breaking surrogate pairs; concatenation reproduces the source. */
export const splitRecruitingText = (text: string, maxBytes: number) => {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const point of text) {
    const bytes = Buffer.byteLength(point);
    if (bytes > maxBytes) throw new Error('Material budget is too small');
    if (size + bytes > maxBytes) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += point;
    size += bytes;
  }
  if (current) parts.push(current);
  return parts;
};

/** Covers every character and image once; this byte heuristic is deliberately not reported as token counting. */
export const planRecruitingMaterial = (
  materials: { label: string; text: string; previews: string[] }[],
  note: string,
  maxBytes: number,
): RecruitingMaterialPart[] => {
  if (maxBytes < 8000) throw new Error('Material budget is too small');
  const parts: Omit<RecruitingMaterialPart, 'key'>[] = [];
  for (const [index, source] of [
    { label: '本次说明与岗位正文', text: note, previews: [] },
    ...materials,
  ].entries()) {
    const prefix = `${source.label}\n`;
    const budget = maxBytes - Buffer.byteLength(prefix);
    for (const text of splitRecruitingText(source.text, budget))
      parts.push({ text: prefix + text, previews: [] });
    const batchSize = Math.max(1, Math.floor(budget / 4000));
    for (let offset = 0; offset < source.previews.length; offset += batchSize)
      parts.push({
        text: `${prefix}第${offset + 1}至${Math.min(offset + batchSize, source.previews.length)}页图`,
        previews: source.previews
          .slice(offset, offset + batchSize)
          .map((name) => ({ materialIndex: index - 1, name })),
      });
  }
  if (parts.length > 64)
    throw new Error('Material requires more than 64 model parts');
  return parts.map((part) => ({
    ...part,
    key: createHash('sha256').update(JSON.stringify(part)).digest('hex'),
  }));
};
