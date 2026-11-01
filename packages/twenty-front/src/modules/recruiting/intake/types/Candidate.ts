/** Search results expose only fields needed to choose the right candidate. */
export type RecruitingCandidate = {
  id: string;
  name: { firstName: string; lastName: string };
  jobTitle?: string;
};
