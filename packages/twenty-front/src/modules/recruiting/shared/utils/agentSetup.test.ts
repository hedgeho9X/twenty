/** Checks public downloads and HTTP clipboard behavior without real credentials. */
import { buildFanhanAgentPrompt, copyFanhanAgentPrompt } from './agentSetup';

it('includes public release artifacts and only the caller-provided credential', () => {
  const prompt = buildFanhanAgentPrompt('http://150.158.164.85', 'test-key');
  expect(prompt).toContain('http://150.158.164.85');
  expect(prompt).toContain('fanhan-cli.tgz');
  expect(prompt).toContain('fanhan-recruiting-skill.zip');
  expect(prompt).toContain('API Key：test-key');
  expect(buildFanhanAgentPrompt('http://localhost')).toContain('请向我索取');
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
