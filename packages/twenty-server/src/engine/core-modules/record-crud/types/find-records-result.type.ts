export type FindRecordsResult = {
  records: unknown[];
  count: number;
  hasNextPage: boolean;
  endCursor?: string | null;
};
