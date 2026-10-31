/** Keeps subscription credentials, temporary authorization and provider access inside the native server process. */
import { Module } from '@nestjs/common';
import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { SiwcStoreService } from './siwc-store.service';

@Module({
  imports: [TypeORMModule, SecretEncryptionModule],
  providers: [SiwcStoreService],
  exports: [SiwcStoreService],
})
/** Adds no proxy port; loopback callbacks exist only during explicitly initiated authorization. */
export class ChatgptSubscriptionModule {}
