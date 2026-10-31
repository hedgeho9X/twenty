/** Defines the small operator-facing HTTP contract; raw material and transport receipts remain separate. */
export type RecruitingCompany = {
  id: string;
  name: string;
  domainName?: { primaryLinkUrl?: string };
  recruitingDescription?: string;
};
