/** Public portal data contains reviewed career fields and scoped file identities, never CRM auth or private notes. */
export type PortalSelfProfile = {
  fullName: string;
  email: string;
  phone: string;
  summary: string;
  skills: string[];
  expectedRoles: string[];
  employmentTypes: string[];
  strictEmployment: boolean;
  workModes: string[];
  strictWorkMode: boolean;
  locations: string[];
  note: string;
};
/** Candidate and company portals share a bounded public projection while only candidate links allow mutation. */
export type RecruitingPortalView = {
  kind: 'CANDIDATE' | 'COMPANY';
  expiresAt: number;
  confirmedAt?: string;
  profile: {
    name: string;
    email: string;
    phone: string;
    summary: string;
    skills: string[];
    experience: string[];
    education: string[];
    expectedRoles: string[];
    employmentTypes: string[];
    strictEmployment?: boolean;
    strictWorkMode?: boolean;
    workModes: string[];
    locations: string[];
    selfIntroduction: string;
    candidateNote: string;
  };
  selfProfile?: PortalSelfProfile;
  files: { fileId: string; label: string }[];
  job?: { title: string; companyName: string; description: string };
  jobs?: {
    jobId: string;
    title: string;
    companyName?: string;
    description?: string;
    recruiting: boolean;
    interested?: boolean;
    consent?: { status: string; valid: boolean };
  }[];
};
