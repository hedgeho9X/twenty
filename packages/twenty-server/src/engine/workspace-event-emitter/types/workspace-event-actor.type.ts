/** Stable principal references let queued consumers recheck current permissions without retaining credentials. */
export type WorkspaceEventActor = {
  userWorkspaceId?: string;
  apiKeyId?: string;
  applicationId?: string;
  viaApplicationId?: string;
  agentId?: string;
};
