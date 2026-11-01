/** Job selection stays bound to a company and explicit recruiting status. */
export type RecruitingJob = {
  id: string;
  name: string;
  companyId?: string;
  jobStatus?: string;
};
