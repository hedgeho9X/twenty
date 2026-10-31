/** Checks resumable long-material extraction and the native model-selection boundary without network calls. */
import { generateText } from 'ai';
import { type AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import {
  type ParsedRecruitingMaterial,
  type RecruitingParserService,
} from './recruiting-parser.service';
import {
  RecruitingExtractorService,
  type RecruitingExtractionPart,
} from './recruiting-extractor.service';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { object: jest.fn() },
}));

/** Uses small native context limits to exercise the same multipart path as real long documents. */
const setup = () => {
  const registry = {
    getDefaultModelForTier: jest.fn(() => ({ modelId: 'native-default' })),
    getModel: jest.fn(() => ({ model: {} })),
    isModelAdminAllowed: jest.fn(() => true),
    getModelConfig: jest.fn(() => ({ contextWindowTokens: 16000 })),
  };
  const parser = {
    preview: jest.fn(
      async (_material: ParsedRecruitingMaterial, _name: string) =>
        Buffer.from('image'),
    ),
  };
  const service = new RecruitingExtractorService(
    registry as unknown as AiModelRegistryService,
    parser as unknown as RecruitingParserService,
  );
  const material = {
    label: '合成简历.pdf',
    text: '完整中文项目与职责。'.repeat(500),
    previews: ['page-1.png', 'page-2.png', 'page-3.png'],
    sourceHash: 'immutable-source-hash',
  } as ParsedRecruitingMaterial;
  return { service, material, registry, parser };
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RECRUITING_MODEL_ID;
});

it('resumes completed parts after a provider failure and merges the final page evidence', async () => {
  const { service, material, registry, parser } = setup();
  const parts: RecruitingExtractionPart[] = [];
  const progress = {
    parts,
    save: async (part: RecruitingExtractionPart) => {
      parts.push(part);
    },
  };
  let index = 0;
  jest.mocked(generateText).mockImplementation(async (request) => {
    index++;
    if (index === 2) throw new Error('temporary provider error');
    const text = JSON.stringify(request);
    return {
      output: {
        facts: [
          text.includes('最后一页特有事实')
            ? '最后一页特有事实'
            : `事实${index}`,
        ],
        identities: [],
        intentStatements: [],
        uncertainties: [],
      },
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    } as never;
  });
  await expect(
    service.candidate([material], '本次说明', progress),
  ).rejects.toThrow('temporary provider error');
  expect(parts).toHaveLength(1);
  const checkpointKey = parts[0].key;
  material.text += '最后一页特有事实';
  // The source changed, so this test must use a distinct immutable source hash too.
  material.sourceHash = 'new-source-hash';
  const result = await service.candidate([material], '本次说明', progress);
  expect(parts.filter((part) => part.key === checkpointKey)).toHaveLength(1);
  expect(parser.preview.mock.calls.map((call) => call[1])).toEqual(
    material.previews,
  );
  expect(
    JSON.stringify(
      jest.mocked(generateText).mock.calls[
        jest.mocked(generateText).mock.calls.length - 1
      ],
    ),
  ).toContain('最后一页特有事实');
  expect(result.coverage).toMatchObject({ previews: 3, merged: true });
  expect(registry.getDefaultModelForTier).toHaveBeenCalledWith('smart');
});

it('does not re-read or regenerate already persisted parts when retrying unchanged material', async () => {
  const { service, material } = setup();
  const parts: RecruitingExtractionPart[] = [];
  const progress = {
    parts,
    save: async (part: RecruitingExtractionPart) => {
      parts.push(part);
    },
  };
  jest.mocked(generateText).mockResolvedValue({
    output: {
      facts: ['原话'],
      identities: [],
      intentStatements: [],
      uncertainties: [],
    },
    usage: { totalTokens: 12 },
  } as never);
  await service.candidate([material], '', progress);
  const initial = jest.mocked(generateText).mock.calls.length;
  await service.candidate([material], '', progress);
  expect(jest.mocked(generateText).mock.calls.length).toBe(initial + 1);
});

it('rejects a disabled pinned model before reading images or billing', async () => {
  const { service, material, registry, parser } = setup();
  process.env.RECRUITING_MODEL_ID = 'disabled';
  registry.isModelAdminAllowed.mockReturnValue(false);
  await expect(service.candidate([material], '')).rejects.toThrow('请先配置');
  expect(parser.preview).not.toHaveBeenCalled();
  expect(generateText).not.toHaveBeenCalled();
  delete process.env.RECRUITING_MODEL_ID;
});
