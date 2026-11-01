/** Composes recruiting layouts with the official Twenty design tokens. */
import { css } from '@linaria/core';
import { styled } from '@linaria/react';
import { themeCssVariables as theme } from 'twenty-ui/theme';

export const StyledRecruitingWorkspace = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  overflow: auto;
  padding: ${theme.spacing[5]};
`;
export const StyledRecruitingStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[4]};
`;
export const StyledRecruitingRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${theme.spacing[2]};
`;
export const StyledRecruitingPanel = styled.section`
  background: ${theme.background.primary};
  border: 1px solid ${theme.border.color.medium};
  border-radius: ${theme.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[4]};
  padding: ${theme.spacing[5]};
`;
export const StyledRecruitingMuted = styled.p`
  color: ${theme.font.color.tertiary};
  font-size: ${theme.font.size.sm};
  line-height: 1.65;
  margin: 0;
`;
export const StyledRecruitingContextText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;
export const StyledRecruitingTitle = styled.h2`
  color: ${theme.font.color.primary};
  font-size: ${theme.font.size.lg};
  font-weight: ${theme.font.weight.medium};
  margin: 0;
  a {
    color: inherit;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;
export const StyledRecruitingError = styled.div`
  border: 1px solid ${theme.border.color.medium};
  border-radius: ${theme.border.radius.sm};
  color: ${theme.color.red};
  padding: ${theme.spacing[3]};
`;
export const StyledRecruitingTable = styled.table`
  border-collapse: collapse;
  font-size: ${theme.font.size.sm};
  text-align: left;
  width: 100%;
  th {
    white-space: nowrap;
    color: ${theme.font.color.tertiary};
    font-weight: ${theme.font.weight.medium};
  }
  th,
  td {
    border-bottom: 1px solid ${theme.border.color.medium};
    padding: ${theme.spacing[3]};
    vertical-align: top;
  }
  a {
    color: ${theme.color.blue};
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
  background: ${theme.background.secondary};
  border: 1px dashed ${theme.border.color.medium};
  border-radius: ${theme.border.radius.md};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[3]};
  justify-content: center;
  &:has(input:focus-visible) {
    outline: 2px solid ${theme.color.blue};
  }
  min-height: 170px;
  padding: ${theme.spacing[6]};
  position: relative;
  transition: border-color 120ms;
  &:hover {
    border-color: ${theme.color.blue};
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
  border: 1px solid ${theme.border.color.medium};
  border-radius: ${theme.border.radius.md};
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow: auto;
  button {
    border-bottom: 1px solid ${theme.border.color.light};
    border-radius: 0;
    justify-content: flex-start;
    min-height: 42px;
    padding: 8px 12px;
    text-align: left;
  }
`;
/** Stable three-step progress shows the current task instead of stacking the whole SOP. */
export const StyledRecruitingSteps = styled.nav`
  color: ${theme.font.color.tertiary};
  display: flex;
  font-size: ${theme.font.size.sm};
  gap: 24px;
  padding: 8px 0 20px;
  [aria-current='step'] {
    color: ${theme.font.color.primary};
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
    background: ${theme.background.primary};
    border: 1px solid ${theme.border.color.medium};
    border-radius: ${theme.border.radius.md};
    box-shadow: ${theme.boxShadow.light};
    color: ${theme.font.color.primary};
  }
  &:hover .job-preview-card,
  &:focus-within .job-preview-card {
    display: block;
  }
`;

/** Semantic low-contrast result state. */
export const StyledRecruitingStatus = styled.span`
  border-radius: 5px;
  display: inline-block;
  font-size: ${theme.font.size.sm};
  padding: 3px 8px;
  white-space: nowrap;
  &[data-tone='green'] {
    background: color-mix(in srgb, ${theme.color.green} 12%, transparent);
    color: ${theme.color.green};
  }
  &[data-tone='red'] {
    background: color-mix(in srgb, ${theme.color.red} 12%, transparent);
    color: ${theme.color.red};
  }
  &[data-tone='yellow'] {
    background: color-mix(in srgb, ${theme.color.orange} 12%, transparent);
    color: ${theme.color.orange};
  }
  &[data-tone='neutral'] {
    background: ${theme.background.secondary};
    color: ${theme.font.color.secondary};
  }
  &[data-tone='blue'] {
    background: color-mix(in srgb, ${theme.color.blue} 12%, transparent);
    color: ${theme.color.blue};
  }
`;

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
    color: ${theme.font.color.primary};
    text-decoration: none;
  }
  font-weight: ${theme.font.weight.medium};
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

/** Keeps a detail back action reachable while long email material scrolls beneath it. */
export const StyledRecruitingSticky = styled.div`
  background: ${theme.background.primary};
  padding: 8px 0;
  position: sticky;
  top: 0;
  z-index: 5;
`;

/** Labeled facts wrap at narrow widths rather than squeezing identity and preferences into a dense JSON block. */
export const StyledRecruitingProfileFacts = styled.dl`
  display: grid;
  gap: 16px 24px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin: 0;
  dt {
    color: ${theme.font.color.tertiary};
    font-size: ${theme.font.size.sm};
    margin-bottom: 5px;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`;
/** Separates skills, occupational history and review notes without nested card borders. */
export const StyledRecruitingProfileSection = styled.section`
  border-top: 1px solid ${theme.border.color.light};
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
