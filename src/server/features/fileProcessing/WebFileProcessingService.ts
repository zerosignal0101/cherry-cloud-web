import { DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { FileProcessingService } from '@main/features/fileProcessing'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import {
  ListAvailableFileProcessorsResultSchema,
  type ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'

/**
 * Processors whose OCR runs on downloaded ONNX models inside an Electron
 * utility process. The web build has no utility-process host, so their model
 * download would fail and their settings panel has nothing to configure — the
 * honest answer is not to list them. Remote processors and Tesseract (an
 * in-process worker) keep working unchanged.
 */
const UNSUPPORTED_PROCESSOR_IDS = new Set<FileProcessorId>(['local-paddleocr', 'local-document'])

@Injectable('FileProcessingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'JobManager'])
export class WebFileProcessingService extends FileProcessingService {
  override listAvailableProcessors(): ListAvailableFileProcessorsResult {
    const { processorIds } = super.listAvailableProcessors()
    return ListAvailableFileProcessorsResultSchema.parse({
      processorIds: processorIds.filter((processorId) => !UNSUPPORTED_PROCESSOR_IDS.has(processorId))
    })
  }
}
