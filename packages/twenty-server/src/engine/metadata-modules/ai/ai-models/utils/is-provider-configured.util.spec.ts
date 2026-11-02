/** Disconnected subscription providers must not break the client configuration endpoint. */
import { isProviderConfigured } from './is-provider-configured.util';
it('requires a connection for ChatGPT providers',()=>{
 expect(isProviderConfigured({authType:'chatgpt'} as never)).toBe(false);
 expect(isProviderConfigured({authType:'chatgpt',subscriptionConnectionId:'connection'} as never)).toBe(true);
});
