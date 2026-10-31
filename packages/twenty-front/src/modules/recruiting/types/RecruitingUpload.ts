/** Native upload completion returns a caller-bound reference, never a model credential. */
export type RecruitingUpload = {
  fileId: string;
  label: string;
  role: 'primary' | 'supplement' | 'archive';
  uploadReceipt: string;
};
