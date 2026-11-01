/** Corrects UTF-8 multipart filenames decoded as Latin-1, leaving real Unicode and legacy single-byte names intact. */
export const decodeMultipartFilename = (value: string): string => {
  if ([...value].some((character) => character.charCodeAt(0) > 255))
    return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'latin1'),
    );
  } catch {
    return value;
  }
};
