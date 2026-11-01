/** Checks readable candidate facts, unknown values and the default-collapsed raw response. */
import { fireEvent, render, screen } from '@testing-library/react';
import { RecruitingParsedProfile } from '@/recruiting/shared/components/ParsedProfile';
jest.mock('@/recruiting/shared/styles', () => ({
  StyledRecruitingMuted: 'p',
  StyledRecruitingRow: 'div',
  StyledRecruitingStack: 'div',
  StyledRecruitingStatus: 'span',
  StyledRecruitingTitle: 'h2',
  StyledRecruitingProfileFacts: 'dl',
  StyledRecruitingProfileSection: 'section',
}));

it('shows structured facts while retaining an unchanged collapsed JSON response', () => {
  const profile = {
    name: '合成候选人',
    summary: '后端研发',
    email: null,
    phone: null,
    expectedRoles: ['后端工程师'],
    category: 'engineering',
    employmentTypes: ['full_time'],
    workModes: ['remote'],
    locations: [],
    skills: ['TypeScript'],
    experience: ['维护异步任务'],
    education: ['计算机本科'],
    needsReview: true,
    reviewNotes: ['缺少联系方式'],
  };
  const before = JSON.stringify(profile);
  const { container } = render(
    <RecruitingParsedProfile profile={profile} kind="CANDIDATE" />,
  );
  expect(screen.getByRole('heading', { name: '合成候选人' })).toBeVisible();
  expect(screen.getByText('全职')).toBeVisible();
  expect(screen.getByText('远程')).toBeVisible();
  expect(screen.getByText('TypeScript')).toBeVisible();
  expect(screen.getByText('维护异步任务')).toBeVisible();
  expect(screen.getByText('缺少联系方式')).toBeVisible();
  const raw = container.querySelector('details')!;
  expect(raw).not.toHaveAttribute('open');
  expect(container.querySelector('pre')).not.toBeVisible();
  fireEvent.click(screen.getByText('查看原始 JSON'));
  expect(raw).toHaveAttribute('open');
  expect(container.querySelector('pre')?.textContent).toBe(
    JSON.stringify(profile, null, 2),
  );
  expect(JSON.stringify(profile)).toBe(before);
});

it('keeps a missing name and absent preferences unknown rather than generating defaults', () => {
  render(
    <RecruitingParsedProfile
      kind="CANDIDATE"
      profile={{ name: null, expectedRoles: [], workModes: [], skills: [] }}
    />,
  );
  expect(screen.getByRole('heading', { name: '姓名待补充' })).toBeVisible();
  expect(screen.getAllByText('未明确').length).toBeGreaterThan(0);
  expect(screen.queryByText('全职')).toBeNull();
  expect(screen.queryByText('远程')).toBeNull();
});

it.each([true, false])(
  'shows every job field for batch=%s and keeps raw JSON collapsed',
  (batch) => {
    const job = {
      title: '平台工程师',
      description: '负责平台研发',
      preferences: '熟悉开源社区',
      category: 'engineering',
      employmentTypes: ['full_time'],
      workModes: ['remote'],
      locations: ['杭州'],
      needsReview: true,
      reviewNotes: ['薪资待确认'],
    };
    const profile = batch
      ? { jobs: [job], needsReview: false, reviewNotes: [] }
      : job;
    const { container } = render(
      <RecruitingParsedProfile kind="JOB" profile={profile} />,
    );
    for (const text of [
      '平台工程师',
      '负责平台研发',
      '熟悉开源社区',
      '研发',
      '全职',
      '远程',
      '杭州',
      '薪资待确认',
    ])
      expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText('需要核对')).toBeVisible();
    expect(screen.getByText('是')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(container.querySelector('pre')).not.toBeVisible();
  },
);
