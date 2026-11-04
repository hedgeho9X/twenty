/** Narrows PSL results using their explicit error and second-level-domain fields. */
import { type ParsedDomain, type parse } from 'psl';
import { isDefined } from 'twenty-shared/utils';

/** Recognizes parsed domains without assuming both union members expose an error field. */
export const isParsedDomain = (
  result: ReturnType<typeof parse>,
): result is ParsedDomain =>
  !isDefined('error' in result ? result.error : undefined) &&
  Object.prototype.hasOwnProperty.call(result, 'sld');
