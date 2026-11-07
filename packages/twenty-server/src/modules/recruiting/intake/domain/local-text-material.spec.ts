/** Ensures text recovery remains traceable and never claims image coverage. */
import { localTextMaterial } from './local-text-material';
it('retains source identity, full Unicode text and explicit partial coverage', () => {
  const text = '原始经历与链接 https://github.com/example\n第二行';
  const result = localTextMaterial({ fileId: 'source', label: 'original.pdf' }, text);
  expect(result.fileId).toBe('source');
  expect(result.text).toBe(text);
  expect(result.status).toBe('partial');
  expect(result.pages).toBe(0);
  expect(result.previews).toEqual([]);
  expect(result.coverage).toContain('不包含图片');
  expect(result.sourceHash).toBe(localTextMaterial({ fileId: 'source', label: 'renamed.pdf' }, text).sourceHash);
});
