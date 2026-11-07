/** Composes recruiting layouts with the official Twenty design tokens. */
import { Card } from '@/recruiting/shadcn/ui/card';
import { Table } from '@/recruiting/shadcn/ui/table';
import { ErrorAlert } from '@/recruiting/shadcn/compat';
import { css } from '@linaria/core';
import { styled } from '@linaria/react';

export const StyledRecruitingWorkspace = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
  button:focus:not(:focus-visible),
  a:focus:not(:focus-visible) {
    box-shadow: none;
    outline: none;
  }
`;
export const StyledRecruitingBody = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 20px;
`;
export const StyledRecruitingStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;
export const StyledRecruitingRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;
export const StyledRecruitingPanel = styled(Card)`
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
`;
export const StyledRecruitingMuted = styled.p`
  color: var(--muted-foreground);
  font-size: 14px;
  line-height: 1.65;
  margin: 0;
`;
export const StyledRecruitingContextText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;
export const StyledRecruitingTitle = styled.h2`
  color: var(--foreground);
  font-size: 18px;
  font-weight: 500;
  margin: 0;
  a {
    color: inherit;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;
export const StyledRecruitingError = styled(ErrorAlert)`
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--destructive);
  padding: 12px;
`;
export const StyledRecruitingTable = styled(Table)`
  border-collapse: collapse;
  font-size: 14px;
  text-align: left;
  width: 100%;
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--card);
    white-space: nowrap;
    color: var(--muted-foreground);
    font-weight: 500;
  }
  th,
  td {
    border-bottom: 1px solid var(--border);
    padding: 12px;
    vertical-align: middle;
  }
  a {
    color: var(--info);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;
export const StyledRecruitingScroll = styled.div`
  max-height: 55vh;
  overflow: auto;
`;
export const StyledRecruitingDrop = styled.label`
  align-items: center;
  background: var(--muted);
  border: 1px dashed var(--border);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  &:has(input:focus-visible) {
    outline: 2px solid var(--info);
  }
  min-height: 170px;
  padding: 24px;
  position: relative;
  transition: border-color 120ms;
  &:hover {
    border-color: var(--info);
  }
  input {
    cursor: pointer;
    height: 100%;
    inset: 0;
    opacity: 0;
    position: absolute;
    width: 100%;
  }
`;

/** Keeps large workflow forms readable while leaving record tables full width. */
export const StyledRecruitingForm = styled.div`
  margin: 0 auto;
  max-width: 760px;
  width: 100%;
`;
/** Compact left-aligned directory choices retain native button semantics. */
export const StyledRecruitingChoices = styled.div`
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow: auto;
  button {
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    justify-content: flex-start;
    min-height: 42px;
    padding: 8px 12px;
    text-align: left;
  }
`;
/** Stable three-step progress shows the current task instead of stacking the whole SOP. */
export const StyledRecruitingSteps = styled.nav`
  color: var(--muted-foreground);
  display: flex;
  font-size: 14px;
  gap: 24px;
  padding: 8px 0 20px;
  [aria-current='step'] {
    color: var(--foreground);
    font-weight: 600;
  }
`;

/** Native-themed transient job preview. */
export const StyledRecruitingJobHover = styled.div`
  position: relative;
  .job-preview-card {
    display: none;
    position: absolute;
    z-index: 20;
    top: 100%;
    left: 0;
    width: min(360px, 65vw);
    max-height: 280px;
    overflow: auto;
    padding: 16px;
    white-space: pre-wrap;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px #00000012;
    color: var(--foreground);
  }
  &:hover .job-preview-card,
  &:focus-within .job-preview-card {
    display: block;
  }
`;

/** Semantic low-contrast result state. */
export { StatusBadge as StyledRecruitingStatus } from '@/recruiting/shadcn/compat';

/** Portal dialogs share the workbench focus treatment without altering other Twenty screens. */
export const recruitingDialogClass = css`
  display: contents;
  button:focus,
  a:focus {
    outline: none;
    box-shadow: none;
  }
  button:focus-visible,
  a:focus-visible {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
`;

/** Quiet native record links retain a clear hover and keyboard affordance. */
export const StyledRecruitingRecordLink = styled.a`
  && {
    color: var(--foreground);
    text-decoration: none;
  }
  font-weight: 500;
  &:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  &:focus-visible {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
`;

/** Fits more tasks per viewport and moves expanded payloads out of the list. */
export const StyledRecruitingDenseQueue = styled.div`
  max-height: 55vh;
  overflow: auto;
  table {
    min-width: 720px;
  }
  th,
  td {
    padding: 7px 9px;
    white-space: nowrap;
    vertical-align: middle;
  }
  td:first-child {
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

/** Places the detail navigation in normal document flow. */
export const StyledRecruitingSticky = styled.div`
  background: var(--card);
  padding: 8px 0;
`;

/** Labeled facts wrap at narrow widths rather than squeezing identity and preferences into a dense JSON block. */
export const StyledRecruitingProfileFacts = styled.dl`
  display: grid;
  gap: 16px 24px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin: 0;
  dt {
    color: var(--muted-foreground);
    font-size: 14px;
    margin-bottom: 5px;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`;
/** Separates skills, occupational history and review notes without nested card borders. */
export const StyledRecruitingProfileSection = styled.section`
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  ul {
    margin: 0;
    padding-left: 20px;
  }
  li {
    line-height: 1.6;
    padding: 3px 0;
    white-space: pre-wrap;
  }
`;
