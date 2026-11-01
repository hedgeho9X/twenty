/** Verifies public sharing excludes private mail and operator data, and binds the exact consented snapshot. */
import {
  portalCandidateFiles,
  portalShareSnapshot,
  publicCandidateProfile,
} from '../portal-profile';

const record = {
  id: 'candidate',
  name: { firstName: '合成' },
  recruitingProfile: {
    summary: '后端',
    skills: ['Go'],
    sourceText: 'private raw inbox',
    note: 'private operator note',
  },
  candidateServiceNotes: { markdown: 'confidential service note' },
  candidateSearchJson: {
    experience: [{ value: 'legacy confidential operator-derived blob' }],
  },
  candidateResumes: [
    { fileId: 'resume', label: 'cv.pdf', url: 'private-token-url' },
    { fileId: 'mail', label: 'mail-body.txt' },
    { fileId: 'eml', label: 'original.eml' },
  ],
};

it('publishes only explicit career/contact fields and resume identities', () => {
  expect(portalCandidateFiles(record)).toEqual([
    { fileId: 'resume', label: 'cv.pdf' },
  ]);
  const exported = JSON.stringify(portalShareSnapshot(record, ['resume']));
  for (const secret of [
    'private raw inbox',
    'private operator note',
    'confidential',
    'private-token-url',
    'mail-body',
    'legacy confidential',
  ])
    expect(exported).not.toContain(secret);
});

it('rejects foreign file IDs and changes consent hash only when visible data or selected files change', () => {
  expect(() => portalShareSnapshot(record, ['foreign'])).toThrow();
  const baseline = portalShareSnapshot(record, ['resume']);
  expect(
    portalShareSnapshot(
      { ...record, candidateServiceNotes: 'different private note' },
      ['resume'],
    ).profileHash,
  ).toBe(baseline.profileHash);
  expect(
    portalShareSnapshot(
      {
        ...record,
        recruitingProfile: {
          ...record.recruitingProfile,
          skills: ['Go', 'Python'],
        },
      },
      ['resume'],
    ).profileHash,
  ).not.toBe(baseline.profileHash);
  expect(publicCandidateProfile(record).skills).toEqual(['Go']);
});
