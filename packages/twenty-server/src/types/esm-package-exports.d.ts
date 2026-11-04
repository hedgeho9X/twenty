/** Resolves installed package declarations for the server's CommonJS module resolver. */
declare module '@lingui/message-utils/compileMessage' {
  export type CompiledIcuChoices =
    import('@lingui/message-utils/dist/compileMessage.cjs').CompiledIcuChoices;
  export type CompiledMessage =
    import('@lingui/message-utils/dist/compileMessage.cjs').CompiledMessage;
  export type CompiledMessageToken =
    import('@lingui/message-utils/dist/compileMessage.cjs').CompiledMessageToken;
  export const compileMessage: typeof import('@lingui/message-utils/dist/compileMessage.cjs').compileMessage;
  export const compileMessageOrThrow: typeof import('@lingui/message-utils/dist/compileMessage.cjs').compileMessageOrThrow;
}

declare module '@file-type/pdf' {
  import type { Detector, FileTypeResult } from 'file-type';
  export interface PdfTypeResult extends FileTypeResult {
    archive?: boolean;
  }
  export const detectPdf: Detector;
}
