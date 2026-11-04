/** Compile-only contracts ensure package declaration bridges retain their original input types. */
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { detectPdf } from '@file-type/pdf';

/** Keeps negative type assertions unreachable in emitted JavaScript. */
if (false) {
  // @ts-expect-error ICU messages are strings, not numeric input.
  compileMessage(42);
  // @ts-expect-error PDF detector identifiers are strings.
  detectPdf.id = 42;
  // @ts-expect-error PDF detection requires a tokenizer, not numeric input.
  detectPdf.detect(42);
}
