/** Runs the same workbench without the CRM shell for local interaction verification. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { messages } from './locales/generated/zh-CN';
import { RecruitingWorkspacePage } from './pages/recruiting/RecruitingWorkspacePage';
i18n.load('zh-CN', messages);
i18n.activate('zh-CN');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider i18n={i18n}>
      <BrowserRouter>
        <div style={{ height: '100dvh' }}>
          <RecruitingWorkspacePage standalone />
        </div>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
);
