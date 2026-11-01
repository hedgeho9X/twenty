import { AiFeatureModelsService } from './services/ai-feature-models.service';
import { Global, Module } from '@nestjs/common';

import { EnterpriseModule } from 'src/engine/core-modules/enterprise/enterprise.module';
import { ChatgptSubscriptionModule } from 'src/engine/core-modules/chatgpt-subscription/chatgpt-subscription.module';
import { AiModelConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-config.service';
import { AiModelPreferencesService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-preferences.service';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { DefaultAiCatalogService } from 'src/engine/metadata-modules/ai/ai-models/services/default-ai-catalog.service';
import { ModelsDevCatalogService } from 'src/engine/metadata-modules/ai/ai-models/services/models-dev-catalog.service';
import { ProviderConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/provider-config.service';
import { SdkProviderFactoryService } from 'src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service';

@Global()
@Module({
  imports: [EnterpriseModule, ChatgptSubscriptionModule],
  providers: [
    AiFeatureModelsService,
    DefaultAiCatalogService,
    ProviderConfigService,
    SdkProviderFactoryService,
    ModelsDevCatalogService,
    AiModelPreferencesService,
    AiModelRegistryService,
    AiModelConfigService,
  ],
  exports: [
    AiFeatureModelsService,
    DefaultAiCatalogService,
    AiModelRegistryService,
    AiModelPreferencesService,
    AiModelConfigService,
    SdkProviderFactoryService,
    ModelsDevCatalogService,
  ],
})
export class AiModelsModule {}
