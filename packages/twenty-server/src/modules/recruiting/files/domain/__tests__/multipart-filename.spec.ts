/** Covers browser multipart mojibake without double-decoding valid filenames. */
import { decodeMultipartFilename } from '../multipart-filename';
it('recovers UTF-8 Chinese filenames misread as Latin-1', () => {
  const original = '【应届】多模态算法工程师_北京 40-70K 林同学.pdf';
  const encoded = Buffer.from(original, 'utf8').toString('latin1');
  expect(decodeMultipartFilename(encoded)).toBe(original);
});
it.each(['简历.pdf', 'résumé.pdf', 'resume.pdf', '工程师 résumé.pdf'])(
  'preserves an already valid filename %s',
  (value) => {
    expect(decodeMultipartFilename(value)).toBe(value);
  },
);
it('is idempotent after recovery', () => {
  const name = decodeMultipartFilename(
    Buffer.from('简历.pdf').toString('latin1'),
  );
  expect(decodeMultipartFilename(name)).toBe(name);
});
