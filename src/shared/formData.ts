import type { FormDataEntry } from './api';

export const MAX_FORM_DATA_FILE_BYTES = 50 * 1024 * 1024;

export interface SelectedFormDataFile {
  blob: Blob;
  fileName: string;
}

const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

function interpolate(value: string, environment: Record<string, string>): string {
  return value.replace(variablePattern, (placeholder, key: string) =>
    Object.hasOwn(environment, key.trim()) ? environment[key.trim()] : placeholder,
  );
}

export function buildMultipartFormData(
  entries: FormDataEntry[],
  environment: Record<string, string>,
  selectedFiles: ReadonlyMap<string, SelectedFormDataFile>,
): FormData {
  const formData = new FormData();
  for (const entry of entries) {
    if (entry.enabled === false || !entry.key.trim()) continue;
    const key = interpolate(entry.key, environment);
    if (entry.type === 'file') {
      const selectedFile = entry.fileToken ? selectedFiles.get(entry.fileToken) : undefined;
      if (!selectedFile) throw new Error('Choose a file for each enabled form-data file field before sending.');
      formData.append(key, selectedFile.blob, selectedFile.fileName);
    } else {
      formData.append(key, interpolate(entry.value, environment));
    }
  }
  return formData;
}