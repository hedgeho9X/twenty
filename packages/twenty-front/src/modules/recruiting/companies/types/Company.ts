/** Defines the small operator-facing HTTP contract; raw material and transport receipts remain separate. */
import { type FieldRichTextValue } from '@/object-record/record-field/ui/types/FieldMetadata';

/** Keeps current company context compatible with native rich-text and migrated plain-text preferences. */
export type RecruitingCompany = {
  id: string;
  name: string;
  domainName?: { primaryLinkUrl?: string };
  recruitingDescription?: string;
  recruitmentPreferences?: FieldRichTextValue | string | null;
};
