import { getRecord, putRecord } from './BackupStore'
import type { CloudProviderId, CloudStorage } from './CloudStorage'
import { appKey, isConnected as isDropboxConnected } from './DropboxAuthorization'
import { DropboxStorage } from './DropboxStorage'
import { isS3Connected, S3Storage } from './S3Storage'

interface SelectionRecord {
  readonly key: typeof SELECTION_KEY
  readonly provider: CloudProviderId
}

const SELECTION_KEY = 'cloud-provider'
const storages: Record<CloudProviderId, CloudStorage> = { dropbox: new DropboxStorage(), s3: new S3Storage() }

export const CLOUD_PROVIDER_NAMES: Readonly<Record<CloudProviderId, string>> = {
  dropbox: 'Dropbox',
  s3: 'S3',
}

/** Dropbox needs the build's app key; S3 needs only the user's settings. */
export function getAvailableProviders(): CloudProviderId[] {
  return appKey() ? ['dropbox', 's3'] : ['s3']
}

export function getCloudStorage(provider: CloudProviderId): CloudStorage {
  return storages[provider]
}

export async function isProviderConnected(provider: CloudProviderId): Promise<boolean> {
  return provider == 'dropbox' ? isDropboxConnected() : isS3Connected()
}

/** The provider the user chose last; before any choice, a connected one, else the first available. */
export async function getSelectedProvider(): Promise<CloudProviderId> {
  const available = getAvailableProviders()
  const selected = (await getRecord<SelectionRecord>(SELECTION_KEY))?.provider
  if (selected && available.includes(selected)) {
    return selected
  }
  for (const provider of available) {
    if (await isProviderConnected(provider)) {
      return provider
    }
  }
  return available[0]
}

export async function setSelectedProvider(provider: CloudProviderId): Promise<void> {
  await putRecord<SelectionRecord>({ key: SELECTION_KEY, provider })
}
