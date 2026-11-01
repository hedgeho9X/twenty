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
    outline: none;
    box-shadow: none;
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
  border: 1px dashed ${theme.border.color.medium};
  border-radius: ${theme.border.radius.md};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[3]};
  justify-content: center;
  padding: ${theme.spacing[6]};
  &:has(input:focus-visible) {
    outline: 2px solid ${theme.color.blue};
  }
  position: relative;
  min-height: 170px;
  background: ${theme.background.secondary};
  transition: border-color 120ms;
  &:hover {
    border-color: ${theme.color.blue};
  }
  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
`;

/** Keeps large workflow forms readable while leaving record tables full width. */
export const StyledRecruitingForm = styled.div`
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
`;
/** Compact left-aligned directory choices retain native button semantics. */
export const StyledRecruitingChoices = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow: auto;
  border: 1px solid ${theme.border.color.medium};
  border-radius: ${theme.border.radius.md};
  button {
    justify-content: flex-start;
    text-align: left;
    min-height: 42px;
    border-radius: 0;
    border-bottom: 1px solid ${theme.border.color.light};
    padding: 8px 12px;
  }
`;
/** Stable three-step progress shows the current task instead of stacking the whole SOP. */
export const StyledRecruitingSteps = styled.nav`
  display: flex;
  gap: 24px;
  padding: 8px 0 20px;
  color: ${theme.font.color.tertiary};
  font-size: ${theme.font.size.sm};
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
  display: inline-block;
  white-space: nowrap;
  border-radius: 5px;
  padding: 3px 8px;
  font-size: ${theme.font.size.sm};
  &[data-tone='green'] {
    color: ${theme.color.green};
    background: color-mix(in srgb, ${theme.color.green} 12%, transparent);
  }
  &[data-tone='red'] {
    color: ${theme.color.red};
    background: color-mix(in srgb, ${theme.color.red} 12%, transparent);
  }
  &[data-tone='yellow'] {
    color: ${theme.color.orange};
    background: color-mix(in srgb, ${theme.color.orange} 12%, transparent);
  }
  &[data-tone='neutral'] {
    color: ${theme.font.color.secondary};
    background: ${theme.background.secondary};
  }
  &[data-tone='blue'] {
    color: ${theme.color.blue};
    background: color-mix(in srgb, ${theme.color.blue} 12%, transparent);
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
  position: sticky;
  top: 0;
  z-index: 5;
  background: ${theme.background.primary};
  padding: 8px 0;
`;
