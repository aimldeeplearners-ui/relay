import { contextBridge, ipcRenderer } from 'electron';
import type { ApiRequestInput, ApiResponse, CollectionDocument, CollectionExportResult, CollectionImportResult, CollectionLoadResult, CollectionLocationResult, CollectionRunReport, CollectionSaveResult, CurlCopyResult, FormDataFileSelectionResult, RelayApi, RunReportExportResult, RunReportFormat } from '../shared/api';

const relayApi: RelayApi = {
  executeRequest: (input: ApiRequestInput) => ipcRenderer.invoke('api:execute', input) as Promise<ApiResponse>,
  chooseFormDataFile: () => ipcRenderer.invoke('formdata:choose-file') as Promise<FormDataFileSelectionResult>,
  reportRendererError: (errorName: string) => ipcRenderer.send('diagnostics:renderer-error', errorName),
  importCollection: () => ipcRenderer.invoke('collection:import') as Promise<CollectionImportResult>,
  importOpenApiDefinition: () => ipcRenderer.invoke('openapi:import') as Promise<CollectionImportResult>,
  loadCollection: () => ipcRenderer.invoke('collection:load') as Promise<CollectionLoadResult>,
  saveCollection: (collection: CollectionDocument) => ipcRenderer.invoke('collection:save', collection) as Promise<CollectionSaveResult>,
  chooseCollectionLocation: (collection: CollectionDocument) => ipcRenderer.invoke('collection:choose-location', collection) as Promise<CollectionLocationResult>,
  exportCollection: (collection: CollectionDocument, includeSecrets = false) => ipcRenderer.invoke('collection:export', collection, includeSecrets) as Promise<CollectionExportResult>,
  exportRunReport: (report: CollectionRunReport, format: RunReportFormat = 'json') => ipcRenderer.invoke('report:export', report, format) as Promise<RunReportExportResult>,
  copyAsCurl: (input: ApiRequestInput) => ipcRenderer.invoke('request:copy-curl', input) as Promise<CurlCopyResult>,
};

contextBridge.exposeInMainWorld('relay', relayApi);