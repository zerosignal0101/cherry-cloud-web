/**
 * Server-only type stand-ins for the Pi agent stack.
 *
 * The published `@earendil-works/*` declarations pinned by this repo drift from
 * the source tree that consumes them, and the workspace adapter packages embed
 * those types. The web server imports the adapters only to register the runtime;
 * neither package is re-implemented here. Pointing the server tsconfig at these
 * opaque shapes keeps the web build typechecking without forking upstream
 * sources. Runtime values still resolve to the real packages (see
 * `vite.server.config.ts`).
 */

export type JsonValue = any
export type JsonRepresentation = any
export type Context = any
export type Usage = any
export type TextContent = any
export type ImageContent = any
export type ProviderConfig = any
export type ProviderHeaders = any
export type ObjectTransportResponse<T = any> = any
export type ObjectTransports = any
export type AgentToolResult<T = any> = any
export type ToolDefinition = any
export type ExtensionFactory = any
export type McpTransportFactory = any
export type ModelRuntime = any
export type AgentChange = any
export type ConversationId = any
export type EntryId = any
export type ConversationRecord = any
export type Harness = any
export type Storage = any
export type Tx = any
export type ToolRegistration = any
export type Registry = any
export type Schema<T = any> = any
export type SpanAttributes = any
export type SpanStatus = any
export type TelemetryContext = any
export type TelemetryPropagation = any
export type TelemetrySpan = any

export const NOOP_TELEMETRY_CONTEXT: any
export const BACKGROUND_CONTEXT: any
export const copyJson: any
export const awaitWithContext: any
export const withAbortSignal: any
export function createBashToolDefinition(...args: any[]): any
export function createPowerShellToolDefinition(...args: any[]): any
export function createCodemodeExtension(...args: any[]): any
export function createToolSearchExtension(...args: any[]): any
export function createMcpExtension(...args: any[]): any
export function createBashTool(...args: any[]): any
export function createPowerShellTool(...args: any[]): any
export function createNodePhotonImages(...args: any[]): any
export function createCodingTools(...args: any[]): any
export function loadSkills(...args: any[]): any
export function loadProjectContextFiles(...args: any[]): any
export function formatSkillsForPrompt(...args: any[]): any
export function skillPromptResources(...args: any[]): any
export function defineTool(...args: any[]): any
export function defineExtension(...args: any[]): any
export function defineDoc(...args: any[]): any
export function createSession(...args: any[]): any
export function createRegistry(...args: any[]): any
export function createPiRuntime(...args: any[]): any
export function createPiDurableRuntime(...args: any[]): any
export function createAssistantMessageEventStream(...args: any[]): any
export function createModels(...args: any[]): any
export function canSuggestPrompt(...args: any[]): any
export function getCurrentSystemMessage(...args: any[]): any
export function measureSystemContext(...args: any[]): any
export function estimateMessageTokens(...args: any[]): any
export function estimateSystemCharacters(...args: any[]): any
export const SessionManager: any
export const ModelRuntime: any
export const InMemoryCredentialStore: any
export const SqliteStorage: any
export const NodeSqliteDatabase: any
export const openNodeSqliteStorage: any
export const NodeExecutionEnv: any
export const CodemodeSandbox: any
export const streamSimple: any

export type AgentRuntimeEvent = any
export type PiObservation = any
export type PiRuntime = any
export type PiThreadHandle = any
export type PiSessionOptions = any
export type DurableObservation = any
export type PiDurableRuntime = any
export type PiDurableThreadHandle = any
