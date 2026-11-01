/** Lists preserve server pagination rather than presenting the first page as the full pool. */
export type RecruitingPage<T> = {
  records: T[];
  count: number;
  hasNextPage: boolean;
};
