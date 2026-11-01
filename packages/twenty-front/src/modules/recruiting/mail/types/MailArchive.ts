/** Complete mail archives are separate from the candidate intake created from selected material. */
export type RecruitingMailArchive = {
  archiveId: string;
  name: string;
  status: string;
  createdAt?: string;
  receivedAt?: string;
  receivedAtSource?: 'mailbox' | 'archive';
  error?: string;
  artifactCount: number;
  attachmentCount?: number;
  processingStatus?: string;
  intakeIds: string[];
  detail?: {
    metadata?: {
      subject?: string;
      from?: { name?: string; address?: string };
      to?: { name?: string; address?: string }[];
      date?: string;
    };
    artifacts: {
      key: string;
      fileId?: string;
      preview?: { intakeId: string; fileId: string };
      label: string;
      kind: 'raw' | 'metadata' | 'text' | 'html' | 'attachment';
      inline: boolean;
      suggestedResume: boolean;
      mimeType: string;
    }[];
  };
};
