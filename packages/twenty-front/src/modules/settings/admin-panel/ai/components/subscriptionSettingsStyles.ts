/** Composes subscription settings with native Twenty theme tokens, independent of any business workspace. */
import { styled } from '@linaria/react';
import { themeCssVariables as theme } from 'twenty-ui/theme';

export const StyledSubscriptionStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[4]};
`;
export const StyledSubscriptionRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${theme.spacing[2]};
`;
export const StyledSubscriptionPanel = styled.section`
  background: ${theme.background.primary};
  border: 1px solid ${theme.border.color.medium};
  border-radius: ${theme.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${theme.spacing[4]};
  padding: ${theme.spacing[5]};
`;
export const StyledSubscriptionMuted = styled.p`
  color: ${theme.font.color.tertiary};
  font-size: ${theme.font.size.sm};
  line-height: 1.65;
  margin: 0;
`;
export const StyledSubscriptionError = styled.div`
  border: 1px solid ${theme.border.color.medium};
  border-radius: ${theme.border.radius.sm};
  color: ${theme.color.red};
  padding: ${theme.spacing[3]};
`;
export const StyledSubscriptionTable = styled.table`
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
`;
