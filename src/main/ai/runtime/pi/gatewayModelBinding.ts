import { randomUUID } from 'node:crypto'

import type { Usage } from '@earendil-works/pi-ai'
import type { ModelRuntime, ProviderConfig } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { loggerService } from '@logger'
import { getPiTraceContext } from '@main/ai/observability'
import { isPiCompatibleModel, mapEndpointToPiApi } from '@shared/ai/piModelCompatibility'
import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { RetryPartData } from '@shared/data/types/uiParts'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { resolveApiGatewayRuntime } from '../agentApiGateway'
import { resolveAgentContextWindow } from '../agentContextWindow'
import type { AgentRuntimeConnectInput } from '../types'
import { loadPiAi, loadPiApiStreamSimple, loadPiSdk } from './piSdk'

const OBJECT_TRANSPORT_API_KEY = 'cherry-object-transport'

export interface PiGatewayModelBindingOptions {
  /**
   * How native Pi reaches Cherry's gateway. `object` (default) keeps the desktop
   * path: the Pi stream is handed in-process transports. Pinned Pi releases that
   * predate `objectTransports` silently ignore them and try to HTTP the dummy
   * `baseUrl`, so the web build asks for `http` and points Pi at the loopback
   * gateway with an internal credential instead.
   */
  transport?: 'object' | 'http'
}

/** Native Pi protocols target Cherry's internal gateway; Cherry retains provider credentials and billing. */
export async function createPiGatewayModelBinding(
  input: Pick<AgentRuntimeConnectInput, 'sessionId' | 'reasoningEffort' | 'serviceTier' | 'fastMode'>,
  provider: Provider,
  model: Model,
  onUsage?: (usage: Usage, nativeSessionId: string | undefined, responseId?: string) => void,
  sharedModels?: ModelRuntime,
  onRetry?: (event: RetryPartData, nativeSessionId: string) => void,
  options: PiGatewayModelBindingOptions = {}
) {
  if (!isPiCompatibleModel(provider, model)) {
    throw new Error(`Provider "${provider.id}" cannot be routed through the internal gateway for pi agents`)
  }
  const preferredEndpoint =
    model.endpointTypes?.includes(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) &&
    model.endpointTypes.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      : undefined
  const { endpointType } = resolveEffectiveEndpoint(provider, model, preferredEndpoint)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  const api = mapEndpointToPiApi(endpointType, adapterFamily) ?? 'openai-completions'
  const gateway = application.get('ApiGatewayService')
  const modelId = formatGatewayModelId(provider.id, getRawModelId(model))
  const modalities: ('text' | 'image')[] = ['text']
  if (
    model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION) ||
    model.inputModalities?.includes(MODALITY.IMAGE)
  ) {
    modalities.push('image')
  }
  const [{ InMemoryCredentialStore }, { ModelRuntime }, streamSimple] = await Promise.all([
    loadPiAi(),
    loadPiSdk(),
    loadPiApiStreamSimple(api)
  ])
  const modelRuntime =
    sharedModels ??
    (await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    }))
  // Native provider re-registration replaces its models and stream handler.
  const providerName = sharedModels ? `cherry-gateway/${input.sessionId}/${randomUUID()}` : provider.id
  const gatewayRoute = options.transport === 'http' ? await resolveApiGatewayRuntime(input.sessionId) : undefined
  const gatewayBaseUrl = gatewayRoute
    ? `${gatewayRoute.baseUrl}${api === 'google-generative-ai' ? '/v1beta' : '/v1'}`
    : 'http://cherry-runtime.invalid'
  const gatewayApiKey = gatewayRoute?.apiKey ?? OBJECT_TRANSPORT_API_KEY
  const streamWithObservation: NonNullable<ProviderConfig['streamSimple']> = (streamModel, context, streamOptions) => {
    // Native reasoning can enlarge per-call output caps before the gateway receives them.
    const stream = streamSimple(streamModel, context, {
      ...streamOptions,
      ...(gatewayRoute
        ? {}
        : {
            objectTransports: gateway.createAgentObjectTransports({
              ...input,
              headers: streamOptions?.headers,
              traceContext: getPiTraceContext(streamOptions?.telemetry),
              onRetryEvent: (event) => {
                if (streamOptions?.sessionId && !streamOptions.readOnlyFork) {
                  onRetry?.(event, streamOptions.sessionId)
                }
              }
            })
          }),
      disableContinuation: true,
      reasoning: undefined,
      maxRetries: 0
    })
    void stream
      .result()
      .then((message) => {
        if (!streamOptions?.readOnlyFork) {
          onUsage?.(message.usage, streamOptions?.sessionId, message.responseId)
        }
      })
      .catch((error) => {
        loggerService.withContext('PiGatewayModelBinding').error('Failed to observe native model response', { error })
      })
    return stream
  }
  modelRuntime.registerProvider(providerName, {
    name: provider.name,
    api,
    baseUrl: gatewayBaseUrl,
    // Native clients require a key even though object calls use Cherry's trusted execution path.
    apiKey: gatewayApiKey,
    ...(gatewayRoute && { headers: gatewayRoute.usageHeaders }),
    models: [
      {
        id: modelId,
        name: model.name,
        reasoning: model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning !== undefined,
        input: modalities,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: resolveAgentContextWindow(model),
        maxTokens: model.maxOutputTokens ?? 8_192,
        // CherryIN can omit the signature delta on thinking blocks that must be replayed.
        ...(provider.id === 'cherryin' && api === 'anthropic-messages' ? { compat: { allowEmptySignature: true } } : {})
      }
    ],
    streamSimple: streamWithObservation
  })
  await modelRuntime.setRuntimeApiKey(providerName, gatewayApiKey)
  const registered = modelRuntime.getModel(providerName, modelId)
  if (!registered) throw new Error(`Pi gateway model ${modelId} was not registered`)
  return { modelRuntime, model: registered, ...(onRetry && { onRetry }) }
}
