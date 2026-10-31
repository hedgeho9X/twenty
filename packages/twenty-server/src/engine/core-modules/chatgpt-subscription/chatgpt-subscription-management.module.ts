/** Registers account-management HTTP only in the API, keeping authentication/controller dependencies out of model workers. */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { ChatgptSubscriptionModule } from './chatgpt-subscription.module';
import { SiwcLoginService } from './siwc-login.service';
import { ChatgptSubscriptionController } from './chatgpt-subscription.controller';

@Module({
  imports: [
    ChatgptSubscriptionModule,
    TokenModule,
    WorkspaceCacheStorageModule,
    TypeOrmModule.forFeature([UserEntity]),
  ],
  providers: [SiwcLoginService],
  controllers: [ChatgptSubscriptionController],
})
/** A settings page can manage credentials without causing every background worker to own OAuth listeners. */
export class ChatgptSubscriptionManagementModule {}
