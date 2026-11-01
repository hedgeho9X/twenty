/** Freezes archive ownership slots within the native per-field limit and complete MIME expansion bounds. */
export const MAX_RECRUITING_MAIL_ATTACHMENTS = 500;
export const MAX_RECRUITING_MAIL_ARTIFACTS =
  MAX_RECRUITING_MAIL_ATTACHMENTS + 4;

/** Layout changes require an explicit ownership migration rather than reinterpreting existing signed slots. */
export const RECRUITING_MAIL_FILE_LAYOUT = Object.freeze({
  version: 1,
  perField: 60,
  fields: Object.freeze([
    'sourceFiles',
    'sourceFiles2',
    'sourceFiles3',
    'sourceFiles4',
    'sourceFiles5',
    'sourceFiles6',
    'sourceFiles7',
    'sourceFiles8',
    'sourceFiles9',
  ]),
});

if (
  RECRUITING_MAIL_FILE_LAYOUT.fields.length *
    RECRUITING_MAIL_FILE_LAYOUT.perField <
  MAX_RECRUITING_MAIL_ARTIFACTS
)
  throw new Error(
    'Mail archive slots cannot retain every supported MIME artifact',
  );
