/** Covers the unified intake boundary that UI, MCP and mail must share. */
import { intakeInputSchema, jobProfilesSchema } from './schemas';

const file = {
  fileId: '9f972110-76ed-4b99-966c-e0d3a8f58db7',
  label: '合成简历.docx',
};

describe('unified recruiting intake contract', () => {
  it('preserves Chinese notes and line breaks exactly', () => {
    const note = '这是我的自我介绍。\n只考虑全职后端岗位。';
    const input = intakeInputSchema.parse({
      kind: 'CANDIDATE',
      files: [file],
      note,
    });
    expect(input.note).toBe(note);
    expect(input.files[0].role).toBe('primary');
  });

  it('accepts an omitted or null optional note', () => {
    expect(
      intakeInputSchema.safeParse({ kind: 'CANDIDATE', files: [file] }).success,
    ).toBe(true);
    expect(
      intakeInputSchema.safeParse({
        kind: 'CANDIDATE',
        files: [file],
        note: null,
      }).success,
    ).toBe(true);
  });

  it('requires an actual candidate document rather than a note alone', () => {
    expect(
      intakeInputSchema.safeParse({ kind: 'CANDIDATE', text: '我的工作经历' })
        .success,
    ).toBe(false);
  });

  it('does not mistake an archived mail message for the resume to parse', () => {
    expect(
      intakeInputSchema.safeParse({
        kind: 'CANDIDATE',
        files: [{ ...file, role: 'archive' }],
      }).success,
    ).toBe(false);
  });

  it('requires selecting a company before submitting JD text', () => {
    expect(
      intakeInputSchema.safeParse({ kind: 'JOB', text: '招聘后端工程师' })
        .success,
    ).toBe(false);
    expect(
      intakeInputSchema.safeParse({
        kind: 'JOB',
        text: '招聘后端工程师',
        companyId: file.fileId,
      }).success,
    ).toBe(true);
  });

  it('does not allow a caller to supply the background actor', () => {
    expect(
      intakeInputSchema.safeParse({
        kind: 'CANDIDATE',
        files: [file],
        actor: { type: 'system' },
      }).success,
    ).toBe(false);
  });
});

it('does not request review flags or review notes for JD extraction', () => {
  expect(Object.keys(jobProfilesSchema.shape)).toEqual(['jobs']);
  expect(Object.keys(jobProfilesSchema.shape.jobs.element.shape)).not.toContain(
    'needsReview',
  );
  expect(Object.keys(jobProfilesSchema.shape.jobs.element.shape)).not.toContain(
    'reviewNotes',
  );
});
