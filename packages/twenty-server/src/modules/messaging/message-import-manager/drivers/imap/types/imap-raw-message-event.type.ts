/** Internal source event emitted before native CRM projection drops original MIME bytes. */
export type ImapRawMessageEvent = {
  workspaceId: string;
  userWorkspaceId: string;
  connectedAccountId: string;
  folder: string;
  uidValidity: string | null;
  uid: number;
  flags: string[];
  internalDate?: Date | string;
  source: Buffer;
};
