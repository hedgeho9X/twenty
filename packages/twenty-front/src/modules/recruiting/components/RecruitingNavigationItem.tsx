/** Adds the workspace entry only where recruiting metadata has been installed. */
import { useLocation } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { IconBriefcase } from 'twenty-ui/icon';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';

/** Reuses the native drawer, collapse and keyboard navigation behavior. */
export const RecruitingNavigationItem = () => {
  const location = useLocation();
  const { objectMetadataItems } = useObjectMetadataItems();
  if (
    !objectMetadataItems.some(
      (item) => item.nameSingular === 'recruitingIntake',
    )
  )
    return null;
  return (
    <NavigationDrawerItem
      label={t`招聘工作台`}
      Icon={IconBriefcase}
      to="/recruiting-workspace"
      active={location.pathname === '/recruiting-workspace'}
    />
  );
};
