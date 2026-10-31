/** Verifies full source coverage rather than merely checking the planner's own output shape. */
import { planRecruitingMaterial, splitRecruitingText } from '../material-plan';

it('reconstructs all Chinese, emoji, whitespace and boundary characters exactly', () => {
  const source = '中文简历👩🏽‍💻\n\t最后一个项目\r\n'.repeat(3000);
  const parts = splitRecruitingText(source, 1001);
  expect(parts.join('')).toBe(source);
  expect(parts.every((part) => Buffer.byteLength(part) <= 1001)).toBe(true);
  expect(parts.every((part) => !part.includes('\ufffd'))).toBe(true);
});

it('covers all text and all declared previews, including the last page and note', () => {
  const text = '完整职责与项目\n'.repeat(4000);
  const pages = Array.from(
    { length: 21 },
    (_, index) => `page-${index + 1}.png`,
  );
  const planned = planRecruitingMaterial(
    [{ label: '简历.pdf', text, previews: pages }],
    '只接受远程\n',
    16000,
  );
  const textParts = planned.filter(
    (part) => !part.previews.length && part.text.startsWith('简历.pdf\n'),
  );
  expect(
    textParts.map((part) => part.text.slice('简历.pdf\n'.length)).join(''),
  ).toBe(text);
  expect(
    planned.flatMap((part) => part.previews.map((image) => image.name)),
  ).toEqual(pages);
  expect(planned[0].text).toContain('只接受远程');
  expect(planned).toEqual(
    planRecruitingMaterial(
      [{ label: '简历.pdf', text, previews: pages }],
      '只接受远程\n',
      16000,
    ),
  );
});
