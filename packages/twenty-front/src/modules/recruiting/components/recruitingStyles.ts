/** Composes recruiting layouts with the official Twenty design tokens. */
import { styled } from '@linaria/react';
import { themeCssVariables as theme } from 'twenty-ui/theme';

export const StyledRecruitingWorkspace = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
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
  &:focus-within {
    outline: 2px solid ${theme.color.blue};
  }
  input {
    max-width: 100%;
  }
`;
