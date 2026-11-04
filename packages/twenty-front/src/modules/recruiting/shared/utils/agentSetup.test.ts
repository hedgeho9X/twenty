/** Checks public downloads, HTTP/HTTPS prompt wording and HTTP clipboard behavior without real credentials. */
import { buildFanhanAgentPrompt, copyFanhanAgentPrompt } from './agentSetup';

it('includes public release artifacts and only the caller-provided credential', () => {
  const prompt = buildFanhanAgentPrompt('https://43.136.55.30', 'test-key');
  expect(prompt).toContain('https://43.136.55.30');
  expect(prompt).toContain('fanhan-cli-v0.5.0/fanhan-cli.tgz');
  expect(prompt).toContain('fanhan-recruiting-skill.zip');
  expect(prompt).toContain('API Key：test-key');
  expect(buildFanhanAgentPrompt('http://localhost')).toContain('请向我索取');
});

it('mentions FANHAN_ALLOW_HTTP only for an HTTP service origin', () => {
  expect(buildFanhanAgentPrompt('https://43.136.55.30')).not.toContain(
    'FANHAN_ALLOW_HTTP',
  );
  expect(buildFanhanAgentPrompt('http://43.136.55.30')).toContain(
    'FANHAN_ALLOW_HTTP=1',
  );
});

it('copies on an HTTP origin and removes the temporary credential field', async () => {
  const original = navigator.clipboard;
  const command = document.execCommand;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  document.execCommand = jest.fn().mockReturnValue(true);
  try {
    await copyFanhanAgentPrompt('synthetic-key');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  } finally {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: original,
    });
    document.execCommand = command;
  }
});
