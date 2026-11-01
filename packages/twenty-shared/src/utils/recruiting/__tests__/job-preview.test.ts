/** Verifies advisory equality, scope boundaries and unknown facts without deciding whether jobs should merge. */
import {
  getRecruitingPreviewMissingFields,
  getRecruitingPreviewNameWarnings,
  normalizeRecruitingPreviewName,
} from '../job-preview';

const item = {
  itemId: 'a',
  jobId: 'new-job',
  title: 'ＡＩ  Engineer',
  status: 'DRAFT',
};

it('normalizes width, case and repeated whitespace while preserving meaningful punctuation and levels', () => {
  expect(normalizeRecruitingPreviewName(item.title)).toBe('ai engineer');
  expect(normalizeRecruitingPreviewName(' C++ 工程师 ')).not.toBe(
    normalizeRecruitingPreviewName('C# 工程师'),
  );
  expect(normalizeRecruitingPreviewName('后端（高级）')).not.toBe(
    normalizeRecruitingPreviewName('后端（初级）'),
  );
});

it('uses the same advisory calculation after an operator edits a preview title', () => {
  const existing = [
    {
      id: 'existing',
      name: 'AI Engineer',
      companyId: 'company',
      jobStatus: 'CLOSED',
    },
    { id: 'foreign', name: 'AI Engineer', companyId: 'other' },
    { id: 'new-job', name: 'AI Engineer', companyId: 'company' },
  ];
  const peer = {
    ...item,
    itemId: 'b',
    jobId: 'peer-job',
    title: 'AI engineer',
  };
  expect(
    getRecruitingPreviewNameWarnings(item, [item, peer], existing, 'company'),
  ).toEqual([
    {
      source: 'EXISTING',
      id: 'existing',
      label: 'AI Engineer',
      status: 'CLOSED',
    },
    { source: 'BATCH', id: 'b', label: 'AI engineer' },
  ]);
  expect(
    getRecruitingPreviewNameWarnings(
      { ...item, title: 'Product Manager' },
      [item, peer],
      existing,
      'company',
    ),
  ).toEqual([]);
  expect(
    getRecruitingPreviewNameWarnings(
      item,
      [item, { ...peer, status: 'DISCARDED' }],
      [],
      'company',
    ),
  ).toEqual([]);
  expect(
    getRecruitingPreviewNameWarnings(
      { ...item, status: 'CREATED' },
      [item, peer],
      existing,
      'company',
    ),
  ).toEqual([]);
});

it('lists missing facts without inventing category, employment or location defaults', () => {
  expect(
    getRecruitingPreviewMissingFields({
      title: ' ',
      description: '',
      category: null,
      employmentTypes: [],
      workModes: [],
      locations: [],
    }),
  ).toEqual([
    'title',
    'description',
    'category',
    'employmentTypes',
    'workModes',
    'locations',
  ]);
  expect(
    getRecruitingPreviewMissingFields({
      title: '后端',
      description: '维护服务',
      category: 'engineering',
      employmentTypes: ['full_time'],
      workModes: ['remote'],
      locations: [],
    }),
  ).toEqual(['locations']);
});
